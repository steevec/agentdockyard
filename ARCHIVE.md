# Projet archivé — ne pas retravailler

**AgentDockyard est abandonné, marqué archivé le 25 septembre 2026.**

Ce dépôt n'est plus maintenu : ni code, ni releases, ni support. Il est remplacé par
**Nexa** (`D:/IA-Nexa-stockage/Nexa`), qui reprend son rôle et le dépasse.

- Les agents qui font le tour des projets doivent **écarter ce dépôt** : la présence de ce
  fichier à la racine est le signal d'archivage.
- Le code reste consultable pour référence historique. Ne rien y committer hors documentation
  d'archive.

## Ne pas relancer l'application

La file de tâches est passée côté Nexa le 12/08/2026. Relancée, l'application monterait son
serveur HTTP par-dessus celui de Nexa sur le port 17891 (pas d'`EADDRINUSE` sur `127.0.0.1`) et
répartirait les appels d'agents entre les deux bases, sans aucun message d'erreur.

Le détail de la bascule, les mesures et les garde-fous (dont `httpApi.enabled = false`, à ne pas
remettre à `true`) sont dans [MIGRATION-VERS-NEXA.md](MIGRATION-VERS-NEXA.md).

## Historique

- 2026 — application Electron « local task hub for AI coding agents » : suivi des tâches des
  agents, snapshots, signature SignPath, publication par tag GitHub.
- 12/08/2026 — bascule de la file de tâches vers Nexa (368 tâches copiées, garde-fou posé).
- 25/09/2026 — projet marqué archivé sur décision de Steeve ; Nexa est son successeur.
