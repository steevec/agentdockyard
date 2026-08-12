# Ce projet n'est plus la source de vérité des tâches — ne pas le relancer

**Le 12/08/2026, la file de tâches a été reprise par Nexa** (`D:/IA/agent-local`), sur décision de
Steeve : tout regrouper au même endroit, avec un accès depuis l'extérieur que cette application
n'a jamais eu. AgentDockyard reste installé, sa base intacte, mais il ne sert plus.

## Ce qui a été mesuré au moment de la bascule

- 368 tâches copiées vers `D:/IA/agent-local/data/taches.db`, dernier id **6292**.
- **118 tâches actives**, toutes retrouvées à l'arrivée (comparaison une par une contre la
  sauvegarde). Les 4 absentes étaient des purges légitimes : clôturées le 10/08, donc au-delà du
  délai de 2 jours.
- Sauvegarde de la base **et** de la configuration :
  `D:/Developpement/_sauvegardes/agentdockyard-avant-bascule-20260812-124747/`.

## Pourquoi il ne faut pas le relancer

Au démarrage, `http-api.js` sonde `127.0.0.1:17891/health` et cherche **sa propre signature**
(`service === 'AgentDockyard HTTP API'`). C'est désormais le relais de Nexa qui répond, avec une
signature différente : l'application en conclut que le port est libre et **monte son serveur HTTP
par-dessus**. Windows accepte ce double bind sur `127.0.0.1` sans lever `EADDRINUSE` — le commentaire
de `probeHealth` le documente déjà — et répartit ensuite les connexions entrantes entre les deux
serveurs, de façon non déterministe.

Concrètement : une partie des tâches créées par les agents partirait dans l'ancienne base, l'autre
dans Nexa, **sans qu'aucun message ne le signale**.

Garde-fou posé le jour de la bascule : `httpApi.enabled` est passé à `false` dans
`%APPDATA%/AgentDockyard/config.json`. Relancée, l'application affiche donc son ancienne liste
(figée au 12/08/2026) sans intercepter un seul appel d'agent. **Ne pas remettre ce réglage à `true`.**

Le raccourci de démarrage automatique a été retiré vers
`%LOCALAPPDATA%/demarrage-retire-bascule-taches/`.

## Où vit le code maintenant

| Ici | Là-bas, dans Nexa |
|---|---|
| `agent.py` (moteur SQLite, 16 actions) | `src/server/taches.js` |
| `http-api.js` (enveloppe HTTP 17891) | `src/server/taches-facade.js` + relais |
| `main.js` : snapshots, purge, verrous expirés | `src/server/taches-entretien.js` |
| `index.html` / `renderer.js` (fenêtre) | `src/server/taches-ui.html`, ouverte par `taches-fenetre.js` |
| — (n'existait pas) | `src/relais/relais-taches.js` : garde les tâches pendant que Nexa redémarre |
| — (n'existait pas) | `src/server/taches-entrantes.js` : dépôt depuis l'extérieur, par jeton |

L'API publique n'a pas changé d'un caractère : `POST http://192.168.1.62:17891/api/agentdockyard`,
mêmes actions, même enveloppe de réponse. Les ~400 `CLAUDE.md` et les skills planifiées n'ont pas
été touchés. La fidélité de la reprise a été vérifiée par un test différentiel qui rejoue le même
scénario sur les deux moteurs et compare les réponses (`tests/taches-socle.test.js` côté Nexa).
