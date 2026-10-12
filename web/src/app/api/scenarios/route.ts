import { NextResponse } from 'next/server';
import { getSupportedScenarios, getSupportedAgentProfiles } from 'wallbit-agent-eval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scenarios = getSupportedScenarios();
    const agentProfiles = getSupportedAgentProfiles();

    return NextResponse.json({
      success: true,
      scenarios,
      agentProfiles
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve scenarios'
      },
      { status: 500 }
    );
  }
}
