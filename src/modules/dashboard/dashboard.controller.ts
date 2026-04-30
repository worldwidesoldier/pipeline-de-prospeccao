import { Controller, Get, Post, Delete, Put, Param, Query, Res, Body, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import axios from 'axios';
import { DashboardService } from './dashboard.service';
import { ScraperService } from '../scraper/scraper.service';
import { TemplateStore, MysteryShopConfigStore } from '../wa-tester/wa-tester.service';
import { SocEngTemplateStore } from '../social-engineering/social-engineering.service';
import { ActivityService } from '../activity/activity.service';
import { MotorService } from '../motor/motor.service';

const EVO_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE_PROSPECCAO || 'prospeccao';

@Controller()
export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private scraperService: ScraperService,
    private activityService: ActivityService,
    private motorService: MotorService,
  ) {}

  @Get('/')
  serveIndex(@Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', 'public', 'index.html'));
  }

  @Get('api/stats')
  async getStats() { return this.dashboardService.getStats(); }

  @Get('api/pipeline')
  async getPipeline() { return this.dashboardService.getPipelineCounts(); }

  @Get('api/pending')
  async getPending(@Query('campaign_id') campaign_id?: string) {
    return this.dashboardService.getPendingApprovals(campaign_id);
  }

  @Get('api/leads')
  async getLeads(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('campaign_id') campaign_id?: string,
    @Query('niche') niche?: string,
  ) {
    return this.dashboardService.getLeads(status, search, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20, campaign_id, niche);
  }

  @Get('api/campaigns')
  async getCampaigns() { return this.dashboardService.getCampaigns(); }

  @Get('api/niches')
  async getNiches() { return this.dashboardService.getNiches(); }

  @Delete('api/campaigns/:id')
  async deleteCampaign(@Param('id') id: string) {
    return this.dashboardService.deleteCampaign(id);
  }

  @Get('api/activity/recent')
  getActivity(@Query('limit') limit?: string) {
    return this.activityService.getRecent(limit ? parseInt(limit) : 50);
  }

  @Get('api/leads/export')
  async exportLeads(
    @Query('status') status?: string,
    @Query('campaign_id') campaign_id?: string,
    @Res() res?: Response,
  ) {
    const leads = await this.dashboardService.exportLeads(status, campaign_id);
    const escape = (v: any) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };
    const mapsUrl = (lead: any) => {
      const parts = [lead.nome, lead.cidade, lead.estado].filter(Boolean).join(' ');
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
    };
    const headers = ['Nome', 'Endereço', 'Cidade', 'Estado', 'Telefone', 'WhatsApp', 'Site', 'Google Maps'];
    const rows = leads.map(l => [
      escape(l.nome),
      escape(l.endereco),
      escape(l.cidade),
      escape(l.estado),
      escape(l.telefone_google),
      escape((l as any).whatsapp),
      escape(l.site),
      escape(mapsUrl(l)),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send('\uFEFF' + csv); // BOM para Excel abrir em UTF-8
  }

  @Get('api/leads/:id')
  getLead(@Param('id') id: string) { return this.dashboardService.getLeadById(id); }

  @Post('api/leads/:id/generate-email')
  generateEmail(@Param('id') id: string, @Body() body: { context?: string }) {
    return this.dashboardService.generateColdEmail(id, body.context || '');
  }

  @Put('api/leads/:id/whatsapp')
  updateLeadWhatsapp(@Param('id') id: string, @Body() body: { whatsapp: string }) {
    return this.dashboardService.updateLeadWhatsapp(id, body.whatsapp?.trim());
  }

  @Post('api/leads/:id/approve')
  approveLead(@Param('id') id: string) { return this.dashboardService.approveLead(id); }

  @Post('api/leads/:id/discard')
  discardLead(@Param('id') id: string) { return this.dashboardService.discardLead(id); }

  @Post('api/leads/:id/mark-morto')
  markLeadMorto(@Param('id') id: string) { return this.dashboardService.markLeadMorto(id); }

  @Get('api/eng-revisao')
  getEngRevisao() { return this.dashboardService.getEngRevisao(); }

  @Post('api/leads/:id/eng-action')
  dispatchEngAction(
    @Param('id') id: string,
    @Body() body: { action: 'next_eng' | 'morto' | 'handled' },
  ) { return this.dashboardService.dispatchEngAction(id, body.action); }

  @Get('api/kanban')
  async getKanban() { return this.dashboardService.getKanbanData(); }

  @Post('api/leads/:id/convert')
  convertLead(@Param('id') id: string) { return this.dashboardService.convertLead(id); }

  @Post('api/leads/re-enrich-discarded')
  reEnrichDiscarded() { return this.dashboardService.reEnrichDiscarded(); }

  @Post('api/leads/requeue-for-wa-test')
  requeueForWaTest() { return this.dashboardService.requeueEnrichedLeads(); }

  @Post('api/leads/requeue-novo')
  requeueNovo() { return this.dashboardService.requeueNovoLeads(); }

  @Delete('api/leads/all')
  deleteAllLeads() { return this.dashboardService.deleteAllLeads(); }

  @Delete('api/leads/:id')
  deleteLead(@Param('id') id: string) { return this.dashboardService.deleteLead(id); }

  // ── SCRAPER ──────────────────────────────────────────────────

  @Post('api/scraper/trigger')
  async triggerScrape(@Body() body: {
    query: string;
    max?: number;
    templateId?: string;
    campaignName?: string;
    location?: string;
    niche?: string;
  }) {
    if (!body.query || body.query.trim().length < 3) {
      return { error: 'Query muito curta' };
    }
    const job = await this.scraperService.triggerManualScrape(
      body.query.trim(),
      body.max || 30,
      body.templateId,
      body.campaignName?.trim(),
      body.location?.trim(),
      body.niche?.trim(),
    );
    return job;
  }

  @Post('api/scraper/expand-region')
  async expandRegion(@Body() body: { region: string; niche?: string }) {
    if (!body.region?.trim()) return { error: 'Região obrigatória' };
    return this.dashboardService.expandRegion(
      body.region.trim(),
      body.niche?.trim() || 'casa de câmbio',
    );
  }

  // ── MOTOR DE WA TEST ─────────────────────────────────────────

  @Get('api/motor/status')
  async getMotorStatus() {
    return this.dashboardService.getMotorStatus();
  }

  @Post('api/motor/pause')
  async pauseMotor() {
    await this.motorService.pause();
    return { ok: true, status: 'paused' };
  }

  @Post('api/motor/resume')
  async resumeMotor() {
    await this.motorService.resume();
    return { ok: true, status: 'running' };
  }

  // ── TEMPLATES ─────────────────────────────────────────────────

  @Get('api/templates')
  getTemplates() { return TemplateStore.list(); }

  @Post('api/templates')
  createTemplate(@Body() body: { nome: string; texto: string }) {
    if (!body.nome?.trim() || !body.texto?.trim()) return { error: 'Nome e texto são obrigatórios' };
    return TemplateStore.create(body.nome.trim(), body.texto.trim());
  }

  @Put('api/templates/:id')
  updateTemplate(@Param('id') id: string, @Body() body: { nome: string; texto: string }) {
    const t = TemplateStore.update(id, body.nome?.trim(), body.texto?.trim());
    return t ?? { error: 'Template não encontrado' };
  }

  @Delete('api/templates/:id')
  deleteTemplate(@Param('id') id: string) {
    return { ok: TemplateStore.delete(id) };
  }

  // ── SOCIAL ENGINEERING TEMPLATES ─────────────────────────────

  @Get('api/social-eng-templates')
  getSocEngTemplates() { return SocEngTemplateStore.get(); }

  @Put('api/social-eng-templates/:variant')
  updateSocEngTemplate(
    @Param('variant') variant: string,
    @Body() body: { nome: string; texto: string },
  ) {
    if (!['v1', 'v2', 'v3'].includes(variant)) return { error: 'Variante inválida' };
    if (!body.nome?.trim() || !body.texto?.trim()) return { error: 'Nome e texto são obrigatórios' };
    return SocEngTemplateStore.updateVariant(variant as 'v1' | 'v2' | 'v3', body.nome.trim(), body.texto.trim());
  }

  @Get('api/mystery-shop-config')
  getMysteryShopConfig() { return MysteryShopConfigStore.get(); }

  @Put('api/mystery-shop-config/m2a')
  setM2AConfig(@Body() body: { texto: string | null }) {
    MysteryShopConfigStore.setM2A(body.texto ?? null);
    return MysteryShopConfigStore.get();
  }

  @Put('api/mystery-shop-config/m2b')
  setM2BConfig(@Body() body: { texto: string | null }) {
    MysteryShopConfigStore.setM2B(body.texto ?? null);
    return MysteryShopConfigStore.get();
  }

  // ── V2: OPERAÇÃO + BRIEFINGS ──────────────────────────────────

  @Get('api/operacao')
  async getOperacao() { return this.dashboardService.getOperacaoData(); }

  @Post('api/leads/:id/call-outcome')
  async callOutcome(
    @Param('id') id: string,
    @Body() body: { outcome: 'fechou' | 'sem_interesse' | 'sem_resposta' },
  ) {
    if (!['fechou', 'sem_interesse', 'sem_resposta'].includes(body.outcome)) {
      return { error: 'Outcome inválido' };
    }
    return this.dashboardService.callOutcome(id, body.outcome);
  }

  @Get('api/briefings')
  async getBriefings() { return this.dashboardService.getBriefings(); }

  @Get('api/leads/:id/conversation')
  async getLeadConversation(@Param('id') id: string) {
    return this.dashboardService.getLeadConversation(id);
  }

  @Get('api/leads/:id/briefing')
  async getLeadBriefing(@Param('id') id: string) {
    return this.dashboardService.getLeadBriefing(id);
  }

  // ── DEMO ─────────────────────────────────────────────────────

  @Post('api/demo/seed')
  async seedDemo() { return this.dashboardService.seedDemo(); }

  @Delete('api/demo/clear')
  async clearDemo() { return this.dashboardService.clearDemo(); }

  @Get('api/scraper/jobs')
  getJobs() { return this.scraperService.getJobs(); }

  @Get('api/scraper/jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.scraperService.getJob(id);
    return job || { error: 'Job não encontrado' };
  }

  // ── WHATSAPP ─────────────────────────────────────────────────

  @Get('api/whatsapp/status')
  async getWhatsappStatus() {
    try {
      const { data } = await axios.get(`${EVO_URL}/instance/fetchInstances`, {
        headers: { apikey: EVO_KEY }, timeout: 5000,
      });
      const inst = Array.isArray(data) ? data.find((i: any) => i.name === EVO_INSTANCE) : null;
      return {
        connected: inst?.connectionStatus === 'open',
        status: inst?.connectionStatus || 'unknown',
        number: inst?.ownerJid?.replace('@s.whatsapp.net', '') || null,
      };
    } catch {
      return { connected: false, status: 'error', number: null };
    }
  }

  @Get('api/whatsapp/qr')
  async getWhatsappQr() {
    try {
      const { data } = await axios.get(`${EVO_URL}/instance/connect/${EVO_INSTANCE}`, {
        headers: { apikey: EVO_KEY }, timeout: 10000,
      });
      return { qr: data?.base64 || null, count: data?.count || 0 };
    } catch {
      return { qr: null, count: 0 };
    }
  }

  @Post('api/whatsapp/reconnect')
  async reconnectWhatsapp() {
    try {
      await axios.delete(`${EVO_URL}/instance/logout/${EVO_INSTANCE}`, {
        headers: { apikey: EVO_KEY }, timeout: 5000,
      });
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
    const { data } = await axios.get(`${EVO_URL}/instance/connect/${EVO_INSTANCE}`, {
      headers: { apikey: EVO_KEY }, timeout: 10000,
    });
    return { ok: true, qr: data?.base64 || null };
  }
}
