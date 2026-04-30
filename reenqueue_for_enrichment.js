#!/usr/bin/env node
/**
 * Re-enfileira na enrichment_queue todos os leads que agora têm site
 * mas ainda não foram enriquecidos com Crawl4AI desde o backfill.
 * Stagger 15s entre jobs para não saturar OpenAI/Crawl4AI.
 */
require('dotenv').config();
const { Queue } = require('bullmq');
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const queue = new Queue('enrichment_queue', { connection: { host: 'localhost', port: 6379 } });

async function main() {
  // Pega leads que têm site mas whatsapp_source não veio do site nem do IG
  // (ou seja, ainda podem se beneficiar de re-enrich)
  const { data, error } = await supabase
    .from('leads')
    .select('id, nome, site, whatsapp, whatsapp_source')
    .not('site', 'is', null);

  if (error) throw new Error(error.message);

  // Filtra: tem site E (não tem WA OU veio só do Google Maps)
  const eligible = data.filter(l =>
    !l.whatsapp_source || ['unknown', 'google'].includes(l.whatsapp_source)
  );

  console.log(`Total com site: ${data.length}`);
  console.log(`Elegíveis para re-enrich (sem WA do site/IG): ${eligible.length}`);
  if (DRY_RUN) console.log('[DRY RUN] não enfileira nada\n');

  let i = 0;
  for (const lead of eligible) {
    const delay = i * 15_000; // 15s entre jobs
    console.log(`${DRY_RUN ? '[SKIP]' : '[ADD]'} ${lead.nome.substring(0, 50).padEnd(50)} delay=${delay/1000}s site=${(lead.site || '').substring(0,40)}`);
    if (!DRY_RUN) {
      await queue.add('enrich_lead', { leadId: lead.id }, {
        delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
      });
    }
    i++;
  }
  console.log(`\n${DRY_RUN ? '[DRY] seriam enfileirados' : 'Enfileirados'}: ${i}`);
  console.log(`Distribuídos ao longo de ~${Math.round(i * 15 / 60)} min`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => queue.close());
