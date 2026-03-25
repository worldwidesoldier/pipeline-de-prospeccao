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

    // SCORE RESPOSTA WA (40%)
    const scoreResposta = this.calcScoreResposta(lead, waTest);

    // SCORE SITE (20%)
    const scoreSite = this.calcScoreSite(enrichment);

    // SCORE INSTAGRAM (20%)
    const scoreInstagram = this.calcScoreInstagram(enrichment);

    // SCORE GOOGLE (20%)
    const scoreGoogle = this.calcScoreGoogle(lead);

    // SCORE TOTAL
    const scoreTotal = Math.round(
      scoreResposta * 0.40 +
      scoreSite * 0.20 +
      scoreInstagram * 0.20 +
      scoreGoogle * 0.20
    );

    this.logger.log(
      `Score ${lead.nome}: ${scoreTotal}/100 ` +
      `(WA:${scoreResposta} Site:${scoreSite} IG:${scoreInstagram} Google:${scoreGoogle})`
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
    if (scoreTotal >= 40) {
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
        `Lead ${lead.nome} → approval_queue (${isAutomatic ? 'AUTOMÁTICO' : 'MANUAL'})`
      );
    } else {
      await this.crmService.updateLead(leadId, { status: 'descartado' });
      this.logger.log(`Lead ${lead.nome} descartado (score ${scoreTotal} < 40)`);
    }
  }

  private calcScoreResposta(lead: any, waTest: any): number {
    if (!lead.whatsapp || lead.whatsapp_source === 'unknown') return 0;
    if (!waTest || !waTest.respondeu) return 10; // Não respondeu

    const min = waTest.tempo_resposta_min;
    if (min < 5) return 100;
    if (min < 15) return 80;
    if (min < 60) return 60;
    if (min < 240) return 40;
    return 20;
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
    const rating = lead.google_rating || 0;

    if (reviews === 0) return 0;
    if (reviews < 10) return 30;
    if (reviews < 50) return 60;
    if (rating > 4) return 100;
    return 60;
  }
}
