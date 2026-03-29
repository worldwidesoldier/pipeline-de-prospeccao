import { Controller, Get, Post, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('/')
  serveIndex(@Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', 'public', 'index.html'));
  }

  @Get('api/stats')
  async getStats(): Promise<any> {
    return this.dashboardService.getStats();
  }

  @Get('api/pipeline')
  async getPipeline(): Promise<any> {
    return this.dashboardService.getPipelineCounts();
  }

  @Get('api/pending')
  async getPending(): Promise<any> {
    return this.dashboardService.getPendingApprovals();
  }

  @Get('api/leads')
  async getLeads(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getLeads(
      status,
      search,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Post('api/leads/:id/approve')
  approveLead(@Param('id') id: string) {
    return this.dashboardService.approveLead(id);
  }

  @Post('api/leads/:id/discard')
  discardLead(@Param('id') id: string) {
    return this.dashboardService.discardLead(id);
  }
}
