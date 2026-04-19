#!/usr/bin/env node
/**
 * scripts/seed-demo-workflow.js
 *
 * Vide la DB et la remplit avec un scenario narratif d orchestration :
 * claude-cowork pilote la release v2.0 d un projet fictif "WebshopPro"
 * et cascade les taches aux autres agents (claude-code, copilot, codex, steeve).
 * Les contextes/notes rendent la delegation explicite pour les screenshots.
 *
 * Usage : node scripts/seed-demo-workflow.js [agent.exe] [tasks.db]
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

function cloturer(id, note) { return call({ action: 'cloturer', id, note }); }
function reclamer(id, agent) { return call({ action: 'reclamer', id, agent }); }

// ─── 1. Vider la DB ──────────────────────────────────────────────────────────
console.log('[seed] Purge des taches existantes...');
const existing = call({ action: 'lister' });
if (existing && existing.taches) {
  for (const t of existing.taches) {
    call({ action: 'annuler', id: t.id });
  }
  console.log(`[seed] ${existing.taches.length} tache(s) supprimee(s)`);
}
// Purge physique des annulees/fait aussi
call({ action: 'purger_maintenant' });

// ─── 2. Historique (taches cloturees - deja faites) ──────────────────────────
console.log('[seed] Injection du scenario WebshopPro v2.0...');

const hist1 = ajouter({
  agent: 'claude-cowork', repo: 'webshoppro-backend',
  sujet: 'Kickoff release v2.0 : briefing des agents',
  contexte: 'Reunion de demarrage',
  note: 'Reunion virtuelle avec l equipe agent faite. Roadmap v2.0 communiquee :\n- claude-code : refacto service checkout + endpoints\n- copilot : tests + CI\n- codex : migration SQL + i18n + doc\n- steeve : validation business et juridique\n\nTaches detaillees cascadees en suivant.',
  statut: 'en_cours',
});
cloturer(hist1, 'Kickoff fait. Equipe agent alignee sur la v2.0. Objectif release : fin du mois.');

const hist2 = ajouter({
  agent: 'claude-code', repo: 'webshoppro-backend',
  sujet: 'POC technique sur le nouveau service payments',
  contexte: 'Assigne par claude-cowork',
  note: 'Demande par claude-cowork avant de s engager sur la refonte complete.\n\nPOC : fonctionnel avec Stripe + paiements fractionnes + webhook de reconciliation.',
  statut: 'en_cours',
});
cloturer(hist2, 'POC concluant. Feu vert donne a claude-cowork pour lancer le refacto complet.');

const hist3 = ajouter({
  agent: 'copilot', repo: 'webshoppro-backend',
  sujet: 'Setup du pipeline CI GitHub Actions',
  contexte: 'Cascade par claude-cowork',
  note: '',
  statut: 'en_cours',
});
cloturer(hist3, 'Pipeline operationnel sur windows-latest + ubuntu-latest. 100% passing.');

const hist4 = ajouter({
  agent: 'codex', repo: 'webshoppro-backend',
  sujet: 'Audit compatibilite PostgreSQL 15',
  contexte: 'Assigne par claude-cowork prealablement a la migration',
  note: '',
  statut: 'en_cours',
});
cloturer(hist4, 'Audit OK. Zero breaking change sur la codebase actuelle. Go migration v15.');

const hist5 = ajouter({
  agent: 'codex', repo: 'webshoppro-docs',
  sujet: 'Rediger le guide de migration v1 -> v2 pour les integrateurs',
  contexte: 'Delegue par claude-cowork',
  note: '',
  statut: 'en_cours',
});
cloturer(hist5, 'Guide publie sur docs.webshoppro.com/migration-v2. 8 pages, 12 exemples de code.');

// ─── 3. En cours, reclamees ou urgentes ──────────────────────────────────────

const task_refacto = ajouter({
  agent: 'claude-code', repo: 'webshoppro-backend',
  sujet: 'Refacto du service checkout pour paiements fractionnes (3x / 4x)',
  contexte: 'Assigne par claude-cowork le 18/04',
  note: 'OBJECTIF (par claude-cowork) : supporter Stripe Installments 3x et 4x sans frais.\n\nPLAN D ACTION :\n1. Extraire la logique actuelle en trait PaymentProcessorTrait\n2. Implementer InstallmentsProcessor avec split automatique\n3. Gerer le webhook Stripe installment.completed\n4. Updater les tests existants + en ajouter\n\nDEPENDANCES :\n- POC #' + hist2 + ' (fait, feu vert)\n- Tests a faire par copilot apres ce refacto\n\nETAT :\n- [x] Extraction trait\n- [ ] InstallmentsProcessor (en cours)\n- [ ] Webhook\n- [ ] Tests',
  statut: 'en_cours',
});
reclamer(task_refacto, 'claude-code');

ajouter({
  agent: 'claude-code', repo: 'webshoppro-backend',
  sujet: 'Implementer l endpoint POST /api/v2/subscriptions',
  contexte: 'Delegue par claude-cowork',
  note: 'Nouveau endpoint unifie pour creer un abonnement + premier paiement.\nSchema valide par claude-cowork.',
  statut: 'en_cours',
});

ajouter({
  agent: 'copilot', repo: 'webshoppro-backend',
  sujet: 'Ecrire 30 tests unitaires pour InstallmentsProcessor',
  contexte: 'Cascade par claude-cowork apres completion du refacto #' + task_refacto,
  note: 'Attendre que claude-code finisse le refacto (tache #' + task_refacto + ').\nCouverture cible : 95% sur le nouveau processor.',
  statut: 'en_attente',
});

ajouter({
  agent: 'codex', repo: 'webshoppro-backend',
  sujet: 'Migration SQL : schema payments v1 -> v2 (installments + refunds partiels)',
  contexte: 'Assigne par claude-cowork, critique avant deploiement',
  note: 'OBJECTIF (par claude-cowork) : rendre le schema payments compatible avec les paiements fractionnes et les remboursements partiels.\n\nPLAN :\n1. Script ALTER pour ajouter payments.installment_plan_id et payments.parent_id\n2. Backfill des donnees existantes (tous en installment_plan = null, OK)\n3. Script de rollback\n4. Test sur dump prod anonymise\n\nCRITIQUE : deploiement en 2 phases obligatoires (schema v1+v2 compatibles pendant 48h).',
  statut: 'a_faire_rapidement',
});

const task_front = ajouter({
  agent: 'claude-code', repo: 'webshoppro-frontend',
  sujet: 'Nouveau formulaire de checkout en 3 etapes (panier -> adresse -> paiement)',
  contexte: 'Delegue par claude-cowork',
  note: 'Maquettes recues de steeve le 15/04.\nStack : React + TanStack Form + validation Zod.\n\nETAT :\n- [x] Etape 1 panier\n- [x] Etape 2 adresse\n- [ ] Etape 3 paiement (integration Stripe Elements)',
  statut: 'en_cours',
});
reclamer(task_front, 'claude-code');

ajouter({
  agent: 'copilot', repo: 'webshoppro-frontend',
  sujet: 'Tests E2E Playwright du nouveau funnel checkout',
  contexte: 'En attente de #' + task_front + ' par claude-cowork',
  note: '15 scenarios Playwright a couvrir : happy path + erreurs carte + fractionnement + remboursement.',
  statut: 'en_attente',
});

ajouter({
  agent: 'codex', repo: 'webshoppro-frontend',
  sujet: 'Traduire les nouvelles chaines UI en 5 langues (EN, ES, DE, IT, NL)',
  contexte: 'Delegue par claude-cowork',
  note: '142 cles nouvelles dans le fichier i18n. Traductions via DeepL API + relecture manuelle des tournures commerciales.',
  statut: 'en_cours',
});

ajouter({
  agent: 'copilot', repo: 'webshoppro-docs',
  sujet: 'Generer les captures d ecran pour la doc de migration',
  contexte: 'Delegue par claude-cowork',
  note: '22 captures a generer via Playwright script, toutes en 1440x900 et format webp.',
  statut: 'en_cours',
});

const task_audit = ajouter({
  agent: 'claude-cowork', repo: 'webshoppro-infra',
  sujet: 'Audit final avant deploiement prod v2.0',
  contexte: 'Supervise toutes les taches en cours',
  note: 'Checklist finale :\n- [x] Tests CI en vert sur backend + frontend\n- [ ] Tests E2E Playwright (en attente copilot)\n- [ ] Migration SQL validee en staging\n- [ ] CGV legales validees par steeve\n- [ ] Rollback plan teste\n- [ ] Monitoring Datadog configure\n- [ ] Communication clients preparee',
  statut: 'en_cours',
});
reclamer(task_audit, 'claude-cowork');

ajouter({
  agent: 'claude-code', repo: 'webshoppro-infra',
  sujet: 'Configurer Redis cache pour les sessions v2',
  contexte: 'Delegue par claude-cowork',
  note: 'BLOQUE : en attente de l acces aux credentials Redis prod de l equipe ops (ticket #INFRA-432 ouvert). Relance envoyee.',
  statut: 'bloque',
});

ajouter({
  agent: 'steeve', repo: 'webshoppro-infra',
  sujet: 'Valider juridiquement les nouveaux CGV (mentions Stripe Installments)',
  contexte: 'Demande par claude-cowork avant release',
  note: 'Revue CGV avec le cabinet juridique. Envoyee ce matin. Retour prevu demain 11h.',
  statut: 'a_faire_rapidement',
});

// ─── 4. Une tache transverse bloquante & une annulee ─────────────────────────
ajouter({
  agent: 'copilot', repo: 'webshoppro-backend',
  sujet: 'Implementer le webhook Stripe payment_intent.succeeded v2',
  contexte: 'Cascade par claude-cowork',
  note: 'Webhook a mettre a jour pour gerer le nouveau format installment. Code deja draft, reste a deployer.',
  statut: 'en_cours',
});

// ─── 5. Final ────────────────────────────────────────────────────────────────
const final = call({ action: 'compter' });
console.log(`[seed] OK - ${final && final.count} tache(s) en DB`);
console.log('[seed] Scenario : WebshopPro v2.0 pilote par claude-cowork');
console.log('[seed] Rafraichis l app (F5) pour voir le tableau.');
