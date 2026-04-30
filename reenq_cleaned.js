require('dotenv').config();
const { Queue } = require('bullmq');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const q = new Queue('enrichment_queue', { connection: { host: 'localhost', port: 6379 } });

(async () => {
  const { data } = await sb
    .from('leads')
    .select('id,nome,site')
    .or('site.like.%daycambio%,site.like.%lojas.cvc%');
  for (const [i, lead] of data.entries()) {
    console.log('ADD', lead.nome, '|', lead.site);
    await q.add('enrich_lead', { leadId: lead.id }, { delay: i * 20000, attempts: 3 });
  }
  console.log('Total:', data.length);
  await q.close();
})();
