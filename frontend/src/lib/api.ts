import type {
  PendingItem, Stats, PipelineCounts, Lead, WaTemplate,
  OutreachTemplates, ScraperJob, WhatsappStatus, KanbanData,
  ActivityEvent, CampaignStat,
} from '@/types/api'

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function post(url: string, body?: unknown) {
  return req<unknown>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function put<T>(url: string, body: unknown) {
  return req<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function del(url: string) {
  return req<unknown>(url, { method: 'DELETE' })
}

export const api = {
  getPending:          () => req<PendingItem[]>('/api/pending'),
  getStats:            () => req<Stats>('/api/stats'),
  getPipeline:         () => req<PipelineCounts>('/api/pipeline'),
  getLeads:            (p: { status?: string; search?: string; page?: number; limit?: number; campaign_id?: string }) => {
    const q = new URLSearchParams()
    if (p.status) q.set('status', p.status)
    if (p.search) q.set('search', p.search)
    if (p.campaign_id) q.set('campaign_id', p.campaign_id)
    q.set('page', String(p.page ?? 1))
    q.set('limit', String(p.limit ?? 20))
    return req<{ leads: Lead[]; total: number }>('/api/leads?' + q)
  },
  getLead:             (id: string) => req<Lead>(`/api/leads/${id}`),
  generateEmail:       (id: string, context: string) => post(`/api/leads/${id}/generate-email`, { context }) as Promise<{ email: string }>,
  approveLead:         (id: string) => post(`/api/leads/${id}/approve`),
  discardLead:         (id: string) => post(`/api/leads/${id}/discard`),
  deleteLead:          (id: string) => del(`/api/leads/${id}`),
  deleteAllLeads:      () => del('/api/leads/all'),
  getTemplates:        () => req<WaTemplate[]>('/api/templates'),
  createTemplate:      (body: { nome: string; texto: string }) => post('/api/templates', body),
  updateTemplate:      (id: string, body: { nome: string; texto: string }) => put<WaTemplate>(`/api/templates/${id}`, body),
  deleteTemplate:      (id: string) => del(`/api/templates/${id}`),
  getOutreachTemplates: () => req<OutreachTemplates>('/api/outreach-templates'),
  updateOutreachTemplate: (variant: string, body: { nome: string; texto: string }) =>
    put<OutreachTemplates>(`/api/outreach-templates/${variant}`, body),
  getFollowupTemplates: () => req<{ msg2: string; msg3: string; msg4: string }>('/api/followup-templates'),
  updateFollowupTemplate: (msg: string, texto: string) =>
    put<{ msg2: string; msg3: string; msg4: string }>(`/api/followup-templates/${msg}`, { texto }),
  triggerScrape:       (body: { query: string; max: number; templateId?: string; campaignName?: string; location?: string; niche?: string }) => post('/api/scraper/trigger', body),
  getMotorStatus:      () => req<{ status: string; pendingCount: number; todayCount: number; maxDaily: number; remaining: number; lastSentAt: string | null; nextSendAt: string | null; pausedAt: string | null }>('/api/motor/status'),
  pauseMotor:          () => post('/api/motor/pause'),
  resumeMotor:         () => post('/api/motor/resume'),
  requeueWaTest:       () => post('/api/leads/requeue-for-wa-test'),
  getJobs:             () => req<ScraperJob[]>('/api/scraper/jobs'),
  getKanban:           () => req<KanbanData>('/api/kanban'),
  convertLead:         (id: string) => post(`/api/leads/${id}/convert`),
  getActivity:         (limit = 50) => req<ActivityEvent[]>(`/api/activity/recent?limit=${limit}`),
  getCampaigns:        () => req<CampaignStat[]>('/api/campaigns'),
  getWaStatus:         () => req<WhatsappStatus>('/api/whatsapp/status'),
  getWaQr:             () => req<{ qr: string | null }>('/api/whatsapp/qr'),
  reconnectWa:         () => post('/api/whatsapp/reconnect'),
  replayResponses:     () => post('/webhook/replay-responses'),
}
