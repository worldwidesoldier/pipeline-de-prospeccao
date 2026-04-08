#!/usr/bin/env node
/**
 * Re-enfileira leads presos em 'enriched' sem wa_test enviado.
 * Esses leads têm WhatsApp mas perderam o job da wa_test_queue.
 *
 * Uso: node reenqueue_enriched.js [--dry-run]
 */

require('dotenv').config();
const { Queue } = require('bullmq');
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const waTestQueue = new Queue('wa_test_queue', {
  connection: { host: 'localhost', port: 6379 },
});

async function main() {
  console.log(DRY_RUN ? '[DRY RUN] Simulação — nenhum job será adicionado\n' : '');

  // 1. Busca todos leads em 'enriched'
  const { data: enrichedLeads, error } = await supabase
    .from('leads')
    .select('id, nome, whatsapp')
    .eq('status', 'enriched');

  if (error) throw new Error(`Supabase error: ${error.message}`);
  console.log(`Leads em 'enriched': ${enrichedLeads.length}`);

  // 2. Busca lead_ids que já têm wa_test (não precisam re-enfileirar)
  const { data: waTests } = await supabase
    .from('wa_tests')
    .select('lead_id');

  const testedIds = new Set((waTests || []).map(t => t.lead_id));

  // 3. Filtra leads SEM wa_test e COM whatsapp
  const stuck = enrichedLeads.filter(l => !testedIds.has(l.id) && l.whatsapp);
  const noWa = enrichedLeads.filter(l => !testedIds.has(l.id) && !l.whatsapp);

  console.log(`  → ${stuck.length} sem wa_test E com WhatsApp (serão re-enfileirados)`);
  console.log(`  → ${noWa.length} sem wa_test E sem WhatsApp (ignorados)`);
  console.log(`  → ${enrichedLeads.length - stuck.length - noWa.length} já têm wa_test (aguardando reply)\n`);

  if (stuck.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  // 4. Re-enfileira com stagger de 30s entre jobs (não bate tudo de uma vez)
  let count = 0;
  for (const lead of stuck) {
    const delay = count * 30_000; // 30s de intervalo entre cada lead
    console.log(`${DRY_RUN ? '[SKIP]' : '[ADD] '} ${lead.nome.padEnd(45)} delay=${Math.round(delay / 1000)}s`);

    if (!DRY_RUN) {
      await waTestQueue.add(
        'test_whatsapp',
        { leadId: lead.id },
        { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }
    count++;
  }

  if (!DRY_RUN) {
    console.log(`\n✓ ${count} leads re-enfileirados na wa_test_queue`);
    console.log(`  Distribuídos ao longo de ~${Math.round((count * 30) / 60)} min`);
    console.log(`  O rate limiter interno (7-12 min) vai espaçar ainda mais os envios`);
    console.log(`  Daily limit: ${process.env.WA_DAILY_LIMIT || 20} msgs/dia`);
  } else {
    console.log(`\n[DRY RUN] Seriam enfileirados: ${count} leads`);
    console.log('Execute sem --dry-run para de fato enfileirar.');
  }
}

main()
  .catch(err => { console.error('Erro:', err.message); process.exit(1); })
  .finally(() => waTestQueue.close());
