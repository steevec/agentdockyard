#!/usr/bin/env python3
"""
agent.py — Interface Python pour les agents IA (Claude Code, Claude Cowork, Copilot...)

Stockage : SQLite (tasks.db), journal_mode=OFF.
- Sur Windows (Claude Code) : acces SQLite direct, file-locking NTFS natif.
- Sur Linux via VirtioFS (Claude Cowork) : fallback automatique — copie dans /tmp,
  operations la-bas, puis recopie dans tasks.db a la fin (sync_back).
  Raison : flock()/fcntl() ne sont pas supportes cross-OS sur VirtioFS.
Aucune compilation native requise : sqlite3 est dans la stdlib Python.

MEMES ACTIONS que l'ancien webservice HTTP :
  ajouter, modifier, cloturer, annuler, changer_statut,
  reclamer, liberer, lister, lister_par_agent, lister_par_repo,
  recuperer, compter

UTILISATION :
  python agent.py '{"action":"ajouter","agent":"claude-cowork","repo":"Cowork","sujet":"Fix..."}'
  python agent.py '{"action":"reclamer","id":42,"agent":"claude-cowork"}'
  python agent.py '{"action":"modifier","id":42,"note":"Avancement..."}'
  python agent.py '{"action":"cloturer","id":42,"note":"Compte-rendu final"}'
  python agent.py '{"action":"lister_par_repo","repo":"Cowork"}'

RETOUR : JSON avec "statut" (OK/NOK) + "message" + donnees.

MIGRATION : si tasks.json existe et tasks.db est absent/vide, migration automatique.
"""

import sys
import json
import os
import sqlite3
import tempfile
import shutil
from datetime import datetime, timedelta

# ─── Chemins ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# DB_PATH : argv[2] si fourni (mode Electron prod, DB dans userData), sinon DB locale.
DB_PATH    = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SCRIPT_DIR, 'tasks.db')
JSON_PATH  = os.path.join(os.path.dirname(DB_PATH), 'tasks.json')

STATUTS_VALIDES = {'en_cours', 'fait', 'annule', 'bloque', 'en_attente', 'a_faire_rapidement'}

COLUMNS = ['id', 'agent', 'repo', 'sujet', 'contexte', 'note', 'statut',
           'date_creation', 'date_cloture', 'reclame_par', 'date_reclamation']


# ─── Utilitaires ──────────────────────────────────────────────────────────────
def date_now():
    return datetime.now().strftime('%Y%m%d%H%M%S')

def date_minus(seconds):
    return (datetime.now() - timedelta(seconds=seconds)).strftime('%Y%m%d%H%M%S')

def ok(message, extra=None):
    r = {'statut': 'OK', 'message': message}
    if extra:
        r.update(extra)
    return r

def nok(message):
    return {'statut': 'NOK', 'message': message}

def row_to_dict(row):
    return dict(zip(COLUMNS, row))


# ─── Connexion SQLite ──────────────────────────────────────────────────────────
_VIRTIO_TMP = None  # chemin /tmp utilise en mode fallback VirtioFS (None si direct)


def _open_sqlite(path, timeout=15):
    conn = sqlite3.connect(path, timeout=timeout)
    conn.execute('PRAGMA journal_mode=OFF')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA busy_timeout=10000')
    conn.row_factory = sqlite3.Row
    return conn

def get_conn():
    """Ouvre tasks.db avec fallback VirtioFS.

    Sur Windows, SQLite ouvre tasks.db directement (locking NTFS natif).
    Sur Linux via VirtioFS, les syscalls de lock (flock/fcntl) ne sont pas
    supportes entre OS differents : on copie tasks.db dans /tmp, on opere
    dessus, et on ecrit le resultat dans tasks.db via sync_back() en fin
    d'operation.  Le risque de race condition Linux↔Windows est minime en
    pratique (fenetre de quelques millisecondes).
    """
    global _VIRTIO_TMP
    _VIRTIO_TMP = None

    # Tentative directe (fonctionne nativement sur Windows)
    try:
        conn = _open_sqlite(DB_PATH, timeout=2)
        conn.execute('SELECT 1')  # verifie que les requetes passent vraiment
        return conn
    except Exception:
        pass

    # Fallback VirtioFS : copier dans /tmp, operer la-bas, sync_back() a la fin
    tmp_fd, tmp_path = tempfile.mkstemp(prefix='tasks_agent_', suffix='.db')
    os.close(tmp_fd)
    if os.path.exists(DB_PATH):
        with open(DB_PATH, 'rb') as f_src:
            raw = f_src.read()
        with open(tmp_path, 'wb') as f_dst:
            f_dst.write(raw)
    _VIRTIO_TMP = tmp_path
    return _open_sqlite(tmp_path)


def sync_back(conn):
    """Recopie le /tmp DB vers tasks.db si on est en mode fallback VirtioFS."""
    global _VIRTIO_TMP
    tmp = _VIRTIO_TMP
    _VIRTIO_TMP = None
    if not tmp:
        return
    try:
        conn.commit()
        with open(tmp, 'rb') as f:
            data = f.read()
        with open(DB_PATH, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass

def init_db(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            agent          TEXT    NOT NULL DEFAULT '',
            repo           TEXT    NOT NULL DEFAULT '',
            sujet          TEXT    NOT NULL DEFAULT '',
            contexte       TEXT    NOT NULL DEFAULT '',
            note           TEXT    NOT NULL DEFAULT '',
            statut         TEXT    NOT NULL DEFAULT 'en_cours',
            date_creation  TEXT    NOT NULL DEFAULT '',
            date_cloture   TEXT    NOT NULL DEFAULT '',
            reclame_par    TEXT    NOT NULL DEFAULT '',
            date_reclamation TEXT  NOT NULL DEFAULT ''
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    conn.commit()

def get_next_id(conn):
    row = conn.execute("SELECT value FROM meta WHERE key='next_id'").fetchone()
    return int(row[0]) if row else 1

def set_next_id(conn, val):
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('next_id', ?)", (str(val),))


# ─── Migration JSON → SQLite ──────────────────────────────────────────────────
def migrate_from_json(conn):
    """Si tasks.json existe et que tasks est vide, importe les donnees."""
    if not os.path.exists(JSON_PATH):
        return
    count = conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0]
    if count > 0:
        return  # Deja des donnees, pas besoin de migrer
    try:
        with open(JSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        tasks = data.get('tasks', [])
        next_id = data.get('next_id', 1)
        for t in tasks:
            conn.execute('''
                INSERT OR IGNORE INTO tasks
                  (id, agent, repo, sujet, contexte, note, statut,
                   date_creation, date_cloture, reclame_par, date_reclamation)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                t.get('id'), t.get('agent',''), t.get('repo',''),
                t.get('sujet',''), t.get('contexte',''), t.get('note',''),
                t.get('statut','en_cours'), t.get('date_creation',''),
                t.get('date_cloture',''), t.get('reclame_par',''),
                t.get('date_reclamation','')
            ))
        set_next_id(conn, next_id)
        conn.commit()
        # Renommer tasks.json en .migrated pour eviter re-migration
        os.rename(JSON_PATH, JSON_PATH + '.migrated')
        print(f"[migration] {len(tasks)} taches importees depuis tasks.json", file=sys.stderr)
    except Exception as e:
        print(f"[migration] echec (non bloquant) : {e}", file=sys.stderr)


# ─── Purge automatique (appelee uniquement a l'ajout) ─────────────────────────
def purge_old(conn):
    """Supprime les taches fait/annule cloturees depuis plus de 90 jours."""
    limit = date_minus(90 * 24 * 3600)
    cur = conn.execute(
        "DELETE FROM tasks WHERE statut IN ('fait','annule') AND date_cloture != '' AND date_cloture < ?",
        (limit,)
    )
    if cur.rowcount:
        print(f"[purge] {cur.rowcount} tache(s) de plus de 90 jours supprimee(s)", file=sys.stderr)

def liberer_reclamations_expirees(conn):
    """Libere les reclamations de plus de 24h."""
    limit = date_minus(86400)
    conn.execute(
        "UPDATE tasks SET reclame_par='', date_reclamation='' WHERE reclame_par != '' AND date_reclamation < ?",
        (limit,)
    )


# ─── Actions ──────────────────────────────────────────────────────────────────
def ws_ajouter(data_in, conn):
    agent    = (data_in.get('agent')    or '').strip()
    repo     = (data_in.get('repo')     or '').strip()
    sujet    = (data_in.get('sujet')    or '').strip()
    contexte = (data_in.get('contexte') or '').strip()[:255]
    note     = (data_in.get('note')     or '').strip()
    statut   = (data_in.get('statut')   or 'en_cours').strip()

    if not agent: return nok("Champ 'agent' obligatoire")
    if not sujet: return nok("Champ 'sujet' obligatoire")
    if statut not in STATUTS_VALIDES: statut = 'en_cours'

    with conn:
        purge_old(conn)
        liberer_reclamations_expirees(conn)
        cur = conn.execute('''
            INSERT INTO tasks (agent, repo, sujet, contexte, note, statut, date_creation,
                               date_cloture, reclame_par, date_reclamation)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        ''', (agent, repo, sujet, contexte, note, statut, date_now(), '', '', ''))
        id_ = cur.lastrowid
    return ok(f"Tache #{id_} creee", {'id': id_})


def ws_modifier(data_in, conn):
    id_ = data_in.get('id')
    if not id_: return nok("Champ 'id' obligatoire")

    updates = []
    params  = []
    for champ in ['agent', 'repo', 'sujet', 'note', 'contexte']:
        if champ in data_in and data_in[champ] is not None:
            val = str(data_in[champ]).strip()
            if champ == 'contexte': val = val[:255]
            updates.append(f"{champ}=?")
            params.append(val)
    if 'statut' in data_in:
        s = str(data_in['statut']).strip()
        if s not in STATUTS_VALIDES: return nok(f"Statut invalide : {s}")
        updates.append("statut=?"); params.append(s)

    if not updates: return nok("Aucun champ a modifier")
    params.append(id_)
    with conn:
        cur = conn.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id=?", params)
    if cur.rowcount == 0: return nok(f"Tache #{id_} introuvable")
    return ok(f"Tache #{id_} mise a jour")


def ws_cloturer(data_in, conn):
    id_  = data_in.get('id')
    note = (data_in.get('note') or '').strip()
    if not id_: return nok("Champ 'id' obligatoire")
    now = date_now()
    with conn:
        cur = conn.execute(
            "UPDATE tasks SET statut='fait', date_cloture=?, note=CASE WHEN ?!='' THEN ? ELSE note END WHERE id=?",
            (now, note, note, id_)
        )
    if cur.rowcount == 0: return nok(f"Tache #{id_} introuvable")
    # Relire la tache pour confirmer l'ecriture effective et la renvoyer au client
    rows = _fetch_tasks(conn, 'id=?', (id_,))
    if not rows:
        return nok(f"Tache #{id_} cloturee mais recuperation impossible")
    tache = rows[0]
    if tache.get('statut') != 'fait':
        return nok(f"Tache #{id_} : ecriture non effective (statut={tache.get('statut')})")
    return ok(f"Tache #{id_} cloturee", {'tache': tache})


def ws_annuler(data_in, conn):
    id_ = data_in.get('id')
    if not id_: return nok("Champ 'id' obligatoire")
    with conn:
        cur = conn.execute("DELETE FROM tasks WHERE id=?", (id_,))
    return ok(f"Tache #{id_} supprimee") if cur.rowcount else nok(f"Tache #{id_} introuvable")


def ws_changer_statut(data_in, conn):
    id_    = data_in.get('id')
    statut = (data_in.get('statut') or '').strip()
    note   = (data_in.get('note')   or '').strip()
    if not id_: return nok("Champ 'id' obligatoire")
    if statut not in STATUTS_VALIDES: return nok(f"Statut invalide : {statut}")
    date_cloture = date_now() if statut in ('fait', 'annule') else ''
    with conn:
        cur = conn.execute(
            "UPDATE tasks SET statut=?, date_cloture=CASE WHEN ?!='' THEN ? ELSE date_cloture END, "
            "note=CASE WHEN ?!='' THEN ? ELSE note END WHERE id=?",
            (statut, date_cloture, date_cloture, note, note, id_)
        )
    if cur.rowcount == 0: return nok(f"Tache #{id_} introuvable")
    return ok(f"Statut tache #{id_} -> {statut}")


def ws_reclamer(data_in, conn):
    id_   = data_in.get('id')
    agent = (data_in.get('agent') or '').strip()
    if not id_:   return nok("Champ 'id' obligatoire")
    if not agent: return nok("Champ 'agent' obligatoire")
    with conn:
        cur = conn.execute(
            "UPDATE tasks SET reclame_par=?, date_reclamation=? WHERE id=?",
            (agent, date_now(), id_)
        )
    if cur.rowcount == 0: return nok(f"Tache #{id_} introuvable")
    return ok(f"Tache #{id_} reclamee par {agent}")


def ws_liberer(data_in, conn):
    id_ = data_in.get('id')
    if not id_: return nok("Champ 'id' obligatoire")
    with conn:
        cur = conn.execute("UPDATE tasks SET reclame_par='', date_reclamation='' WHERE id=?", (id_,))
    if cur.rowcount == 0: return nok(f"Tache #{id_} introuvable")
    return ok(f"Reclamation tache #{id_} liberee")


def _fetch_tasks(conn, where='', params=()):
    sql = f"SELECT {', '.join(COLUMNS)} FROM tasks"
    if where: sql += f" WHERE {where}"
    return [row_to_dict(r) for r in conn.execute(sql, params).fetchall()]


def ws_lister(data_in, conn):
    tasks = _fetch_tasks(conn)
    tasks.sort(key=lambda t: (t.get('repo',''), t.get('agent',''), t.get('date_creation','')))
    return ok(f"{len(tasks)} tache(s)", {'taches': tasks})


def ws_lister_par_agent(data_in, conn):
    agent = (data_in.get('agent') or '').strip()
    if not agent: return nok("Champ 'agent' obligatoire")
    tasks = _fetch_tasks(conn, 'agent=?', (agent,))
    tasks.sort(key=lambda t: t.get('date_creation',''), reverse=True)
    return ok(f"{len(tasks)} tache(s) pour {agent}", {'taches': tasks})


def ws_lister_par_repo(data_in, conn):
    repo = (data_in.get('repo') or '').strip()
    if not repo: return nok("Champ 'repo' obligatoire")
    tasks = _fetch_tasks(conn, 'repo=?', (repo,))
    tasks.sort(key=lambda t: t.get('date_creation',''), reverse=True)
    return ok(f"{len(tasks)} tache(s) pour repo '{repo}'", {'taches': tasks})


def ws_recuperer(data_in, conn):
    id_ = data_in.get('id')
    if not id_: return nok("Champ 'id' obligatoire")
    rows = _fetch_tasks(conn, 'id=?', (id_,))
    if not rows: return nok(f"Tache #{id_} introuvable")
    return ok(f"Tache #{id_}", {'tache': rows[0]})


def ws_compter(data_in, conn):
    where, params = [], []
    if data_in.get('agent'):  where.append('agent=?');  params.append(data_in['agent'])
    if data_in.get('repo'):   where.append('repo=?');   params.append(data_in['repo'])
    if data_in.get('statut'): where.append('statut=?'); params.append(data_in['statut'])
    sql = "SELECT COUNT(*) FROM tasks" + (f" WHERE {' AND '.join(where)}" if where else '')
    count = conn.execute(sql, params).fetchone()[0]
    return ok(f"{count} tache(s)", {'count': count})


def ws_purger_maintenant(data_in, conn):
    """Purge immediate des taches fait/annule cloturees, toutes dates confondues.

    Contrairement a purge_old() qui n'efface que les cloturees de plus de 90j,
    cette action declenchee depuis le panneau Parametres vide immediatement
    les archives.
    """
    with conn:
        cur = conn.execute(
            "DELETE FROM tasks WHERE statut IN ('fait','annule') AND date_cloture != ''"
        )
        deleted = cur.rowcount
    return ok(f"{deleted} tache(s) purgee(s)", {'deleted': deleted})


def ws_exporter_json(data_in, conn):
    """Retourne toutes les taches pour export JSON externe."""
    tasks = _fetch_tasks(conn)
    tasks.sort(key=lambda t: t.get('date_creation',''))
    return ok(f"{len(tasks)} tache(s)", {'taches': tasks})


# ─── Dispatcher ───────────────────────────────────────────────────────────────
ACTIONS = {
    'ajouter':           ws_ajouter,
    'modifier':          ws_modifier,
    'cloturer':          ws_cloturer,
    'annuler':           ws_annuler,
    'changer_statut':    ws_changer_statut,
    'reclamer':          ws_reclamer,
    'liberer':           ws_liberer,
    'lister':            ws_lister,
    'lister_par_agent':  ws_lister_par_agent,
    'lister_par_repo':   ws_lister_par_repo,
    'recuperer':         ws_recuperer,
    'compter':           ws_compter,
    'purger_maintenant': ws_purger_maintenant,
    'exporter_json':     ws_exporter_json,
}


def main():
    if len(sys.argv) < 2:
        print(json.dumps(nok('Usage : python agent.py \'{"action":"...", ...}\'')))
        sys.exit(1)

    try:
        data_in = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps(nok(f"JSON invalide : {e}")))
        sys.exit(1)

    action = (data_in.get('action') or '').strip()
    if not action:
        print(json.dumps(nok("Champ 'action' obligatoire")))
        sys.exit(1)

    handler = ACTIONS.get(action)
    if not handler:
        print(json.dumps(nok(f"Action inconnue : {action}")))
        sys.exit(1)

    try:
        conn = get_conn()
        init_db(conn)
        migrate_from_json(conn)
        result = handler(data_in, conn)
        sync_back(conn)  # no-op si acces direct, recopie si fallback VirtioFS
        conn.close()
    except Exception as e:
        result = nok(f"Erreur : {e}")

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
