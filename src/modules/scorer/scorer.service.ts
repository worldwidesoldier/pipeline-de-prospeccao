import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';

@Injectable()
export class ScorerService {
  private readonly logger = new Logger(ScorerService.name);

  constructor(
    @InjectQueue('approval_queue') private approvalQueue: Queue,
    private crmService: CrmService,
  ) {}

  async scoreLead(leadId: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) return;

    const enrichment = await this.crmService.getEnrichmentByLeadId(leadId);
    const waTest = await this.crmService.getLatestWaTestByLeadId(leadId);

    const scoreGoogle    = this.calcScoreGoogle(lead);      // 35%
    const scoreSite      = this.calcScoreSite(enrichment);  // 25%
    const scoreInstagram = this.calcScoreInstagram(enrichment); // 20%
    const scoreResposta  = this.calcScoreResposta(lead, waTest); // 20%

    // SCORE TOTAL
    const scoreTotal = Math.round(
      scoreGoogle    * 0.35 +
      scoreSite      * 0.25 +
      scoreInstagram * 0.20 +
      scoreResposta  * 0.20
    );

    this.logger.log(
      `Score ${lead.nome}: ${scoreTotal}/100 ` +
      `(Google:${scoreGoogle} Site:${scoreSite} IG:${scoreInstagram} WA:${scoreResposta})`
    );

    // Salvar score
    await this.crmService.saveScore({
      lead_id: leadId,
      score_total: scoreTotal,
      score_resposta: scoreResposta,
      score_site: scoreSite,
      score_instagram: scoreInstagram,
      score_google: scoreGoogle,
    });

    await this.crmService.updateLead(leadId, { status: 'scored' });

    // Rotear baseado no score
    if (scoreTotal >= 30) {
      const isAutomatic = scoreTotal >= 70;
      await this.approvalQueue.add('request_approval', {
        leadId,
        scoreTotal,
        isAutomatic,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      this.logger.log(
        `Lead ${lead.nome} → approval_queue (${isAutomatic ? 'AUTO' : 'MANUAL'})`
      );
    } else {
      await this.crmService.updateLead(leadId, { status: 'descartado' });
      this.logger.log(`Lead ${lead.nome} descartado (score ${scoreTotal} < 30)`);
    }
  }

  private calcScoreResposta(lead: any, waTest: any): number {
    if (!lead.whatsapp) return 0;           // sem WA encontrado
    if (!waTest)        return 15;          // WA existe mas não testado ainda
    if (!waTest.respondeu) return 20;       // WA existe, não respondeu

    const min = waTest.tempo_resposta_min;
    if (min < 5)   return 100;
    if (min < 15)  return 85;
    if (min < 60)  return 65;
    if (min < 240) return 45;
    return 25;
  }

  private calcScoreSite(enrichment: any): number {
    if (!enrichment || !enrichment.tem_site) return 0;
    return enrichment.site_score || 30;
  }

  private calcScoreInstagram(enrichment: any): number {
    if (!enrichment || !enrichment.ig_username) return 0;

    const diasSemPost = enrichment.ig_ultimo_post_dias;
    const seguidores = enrichment.ig_followers || 0;

    if (diasSemPost === null || diasSemPost > 90) return 20;
    if (diasSemPost > 30) return 50;
    if (seguidores < 500) return 70;
    return 100;
  }

  private calcScoreGoogle(lead: any): number {
    const reviews = lead.google_reviews || 0;
    const rating  = lead.google_rating  || 0;

    if (rating === 0) return 0;
    if (reviews === 0) return rating >= 4.5 ? 25 : 15;
    if (reviews < 10)  return 40;
    if (reviews < 50)  return 65;
    if (rating >= 4.0) return 100;
    return 70;
  }
}
