#!/usr/bin/env node
/**
 * scripts/seed-test-data.js
 *
 * Injecte un jeu de taches varie dans la DB de l app installee pour
 * tester l interface en conditions reelles (plusieurs repos, agents,
 * statuts, contenus longs/courts, reclamations, taches fait/annule...).
 *
 * Usage : node scripts/seed-test-data.js [chemin/agent.exe] [chemin/tasks.db]
 */

const { spawnSync } = require('child_process');
const path = require('path');
const os   = require('os');

const AGENT = process.argv[2] || 'C:/Users/steev/AppData/Local/Programs/AgentDockyard/resources/agent.exe';
const DB    = process.argv[3] || path.join(os.homedir(), 'AppData', 'Roaming', 'AgentDockyard', 'tasks.db');

function call(payload) {
  const r = spawnSync(AGENT, [JSON.stringify(payload), DB], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('[seed] echec :', r.stderr || r.stdout);
    return null;
  }
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

function ajouter(data) {
  const r = call({ action: 'ajouter', ...data });
  return r ? r.id : null;
}

function cloturer(id, note) {
  return call({ action: 'cloturer', id, note });
}

function reclamer(id, agent) {
  return call({ action: 'reclamer', id, agent });
}

// ─── ChubbWidget ───────────────────────────────────────────────────────────────
ajouter({
  agent: 'claude-cowork', repo: 'ChubbWidget',
  sujet: 'Refacto du calcul de prime TTC avenant',
  contexte: 'Suite au bug de reconciliation decouvert le 12/04',
  note: 'OBJECTIF : simplifier la fonction calcul_prime_avenant() qui fait 400 lignes.\n\nPLAN :\n1. Extraire la logique TVA dans un helper\n2. Extraire la logique fractionnement\n3. Ajouter tests unitaires avant refacto\n4. Refactorer par petites etapes\n\nFICHIERS :\n- fonction/fonction_global.php (fonction principale)\n- includ/calcul_prime_helper.php (a creer)\n\nETAT :\n- [x] Audit initial fait\n- [ ] Helper TVA\n- [ ] Helper fractionnement\n- [ ] Tests',
  statut: 'en_cours',
});

ajouter({
  agent: 'claude-code', repo: 'ChubbWidget',
  sujet: 'Corriger l affichage du bouton reconciliation quand statut bloque',
  contexte: 'Rapporte par Jean (commercial) ce matin',
  note: 'Le bouton reste actif meme quand le contrat est bloque, ce qui permet aux commerciaux de declencher une reconciliation sur un dossier en attente de validation juridique. Bug visible sur 3 dossiers la semaine derniere.',
  statut: 'a_faire_rapidement',
});

ajouter({
  agent: 'claude-code', repo: 'ChubbWidget',
  sujet: 'Ajouter pagination sur tableau avenants > 50 lignes',
  statut: 'en_attente',
});

ajouter({
  agent: 'copilot', repo: 'ChubbWidget',
  sujet: 'Tests pipeline Chubb - batch 2',
  contexte: 'Completer la suite de tests TesteurBug',
  note: 'Ajouter 12 tests couvrant les scenarios de reconciliation V2 + avenant + annulation.',
  statut: 'en_cours',
});

ajouter({
  agent: 'codex', repo: 'ChubbWidget',
  sujet: 'Migration des anciens dossiers V1 vers V2',
  contexte: 'Il reste 47 dossiers en format V1, blocage possible',
  note: 'Bloque en attendant validation juridique sur les dossiers n148 a n195.',
  statut: 'bloque',
});

ajouter({
  agent: 'steeve', repo: 'ChubbWidget',
  sujet: 'Valider le doc juridique ART-2024-XX avec le service legal',
  contexte: 'Envoye le 02/04, pas de retour',
  note: 'Relancer Marie lundi si toujours pas de retour.',
  statut: 'en_attente',
});

// ─── Cowork ──────────────────────────────────────────────────────────────────
ajouter({
  agent: 'claude-cowork', repo: 'Cowork',
  sujet: 'Optimiser le refresh du dashboard quand > 500 taches',
  contexte: 'Lag perceptible a partir de ~450 taches',
  note: 'OBJECTIF : rendre le rendu fluide meme avec 1000+ taches.\nPLAN : 1. Virtualization du scroll. 2. Pagination cote agent.py. 3. Debounce du refresh.',
  statut: 'en_cours',
});

ajouter({
  agent: 'claude-cowork', repo: 'Cowork',
  sujet: 'Bug VirtioFS : corruption de tasks.db sur ecritures concurrentes',
  note: 'Incident signale le 15/04. Reproduire puis corriger. Fallback /tmp + sync_back a peut-etre une race condition.',
  statut: 'a_faire_rapidement',
});

ajouter({
  agent: 'steeve', repo: 'Cowork',
  sujet: 'Doc utilisateur - rediger la section integration agents',
  statut: 'en_cours',
});

// ─── AgentDockyard (meta) ─────────────────────────────────────────────────────
ajouter({
  agent: 'claude-code', repo: 'AgentDockyard',
  sujet: 'Ajouter support Mac/Linux dans le build',
  contexte: 'Evolution v1.1',
  note: 'Actuellement Windows only. Pour Mac : builder doit signer (besoin cert Apple). Pour Linux : AppImage + .deb.',
  statut: 'en_attente',
});

ajouter({
  agent: 'claude-code', repo: 'AgentDockyard',
  sujet: 'Signature de code Windows pour l installeur',
  contexte: 'Windows Defender avertit en l absence',
  note: 'Necessite certificat EV Code Signing (~300 eur/an) ou certificat standard moins cher.',
  statut: 'en_attente',
});

ajouter({
  agent: 'steeve', repo: 'AgentDockyard',
  sujet: 'Partager le projet sur Reddit r/electronjs et Hacker News',
  contexte: 'Lancement v1.0',
  statut: 'a_faire_rapidement',
});

ajouter({
  agent: 'claude-code', repo: 'AgentDockyard',
  sujet: 'Onglet Statistiques : graphe taches par agent/jour',
  contexte: 'Idee recue via Discord',
  statut: 'en_attente',
});

// ─── Gmail-addon ─────────────────────────────────────────────────────────────
ajouter({
  agent: 'claude-code', repo: 'Gmail-addon',
  sujet: 'Nettoyer les appels API redondants dans sync_gmail()',
  contexte: 'Quota API approche les limites',
  note: 'Reduire de ~30% les appels en cachant la liste labels.',
  statut: 'en_cours',
});

ajouter({
  agent: 'copilot', repo: 'Gmail-addon',
  sujet: 'Fixer crash quand mail sans sujet',
  statut: 'bloque',
});

// ─── Hors repo ───────────────────────────────────────────────────────────────
ajouter({
  agent: 'steeve', repo: '',
  sujet: 'Preparer la declaration URSSAF trimestre Q1',
  contexte: 'Echeance 30/04',
  statut: 'a_faire_rapidement',
});

ajouter({
  agent: 'claude-code', repo: '',
  sujet: 'Tester le nouveau plugin ESLint sur plusieurs projets',
  statut: 'en_attente',
});

// ─── Taches cloturees (pour voir le groupe "X taches terminees") ─────────────
{
  const id = ajouter({
    agent: 'claude-cowork', repo: 'ChubbWidget',
    sujet: 'Fix bug reconciliation ReconciliationV2TraitementCorrectifTrait',
    contexte: 'Issue #142',
    note: 'Bug des curly quotes Unicode remplaces par vrais guillemets',
    statut: 'en_cours',
  });
  if (id) cloturer(id, 'RESOLU : remplace toutes les curly quotes par des vrais guillemets. php -l passe. Teste en QA, zero erreur. PR #143 mergee.');
}
{
  const id = ajouter({
    agent: 'claude-code', repo: 'Cowork',
    sujet: 'Migrer tasks.json vers SQLite',
    note: 'Migration auto au premier demarrage.',
    statut: 'en_cours',
  });
  if (id) cloturer(id, 'Migration OK - tasks.json renomme en .migrated, SQLite pris en charge.');
}
{
  const id = ajouter({
    agent: 'copilot', repo: 'Gmail-addon',
    sujet: 'Ajouter label auto pour mails clients',
    statut: 'en_cours',
  });
  if (id) cloturer(id, 'Deploye en prod sans incident.');
}
{
  const id = ajouter({
    agent: 'steeve', repo: 'AgentDockyard',
    sujet: 'Configurer le workflow release GitHub',
    statut: 'en_cours',
  });
  if (id) cloturer(id, 'Repo cree, remote configure, premier push OK.');
}

// ─── Taches avec reclamation active ──────────────────────────────────────────
{
  const id = ajouter({
    agent: 'claude-cowork', repo: 'Cowork',
    sujet: 'Ajouter option theme sombre plus contraste (AAA)',
    contexte: 'Accessibilite',
    statut: 'en_cours',
  });
  if (id) reclamer(id, 'claude-cowork');
}
{
  const id = ajouter({
    agent: 'claude-code', repo: 'ChubbWidget',
    sujet: 'Audit de securite endpoint ajax_reconciliation',
    contexte: 'Audit externe demande par le DPO',
    statut: 'en_cours',
  });
  if (id) reclamer(id, 'claude-code');
}

// ─── Tache tres longue (stress test rendu) ───────────────────────────────────
ajouter({
  agent: 'codex', repo: 'AgentDockyard',
  sujet: 'Implementer le support Mac via Electron-builder en gerant correctement la signature Apple, la notarization et le shipment sur un store alternatif si besoin',
  contexte: 'Evolution importante demandee par deux utilisateurs Mac',
  note: [
    'OBJECTIF : livrer une version Mac stable sans necessiter de compte Apple Developer cote utilisateur final.',
    '',
    'CONTRAINTES :',
    '- Apple exige la notarization pour les .dmg telecharges hors App Store',
    '- Sans signature, Gatekeeper bloque systematiquement',
    '- Un certificat Apple Developer coute 99 USD/an',
    '- La notarization peut prendre jusqu a 30 minutes par build',
    '',
    'OPTIONS :',
    '1. Distribuer sans signature via un workaround Ctrl+click (mauvaise UX)',
    '2. Payer le certificat et automatiser la notarization dans le CI',
    '3. Passer par un meta-packager comme Homebrew Cask',
    '',
    'PLAN :',
    '1. Etude comparee des 3 options + cout-benefice',
    '2. Prototype de build Mac universel (x64 + arm64)',
    '3. Test sur machine virtuelle MacOS',
    '4. Decision finale et mise en place',
    '',
    'FICHIERS CONCERNES :',
    '- package.json (section build.mac)',
    '- scripts/build-mac.js (a creer)',
    '- .github/workflows/release.yml (a mettre a jour)',
    '',
    'ETAT :',
    '- [ ] Etude des options',
    '- [ ] POC sur Mac prete',
    '- [ ] Choix final',
    '- [ ] Implementation',
    '- [ ] Tests',
    '- [ ] Documentation',
  ].join('\n'),
  statut: 'en_attente',
});

// ─── Final : compter pour feedback ───────────────────────────────────────────
const r = call({ action: 'compter' });
console.log(r && r.count ? `[seed] OK - ${r.count} tache(s) en DB` : '[seed] echec');
