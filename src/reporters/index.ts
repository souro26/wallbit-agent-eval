import type { EvaluationReport, Reporter } from '../types.js';
import { ScenarioResult } from '../types.js';

export class TerminalReporter implements Reporter {
  name = 'terminal';

  async report(report: EvaluationReport): Promise<void> {
    console.log('\nWallbit Agent Evaluation');
    console.log('─────────────────────────\n');

    for (const scenario of report.scenarios) {
      const status = scenario.passed ? '✓' : '✗';
      console.log(`${status} ${scenario.name}`);
      if (scenario.error) {
        console.log(`  Error: ${scenario.error}`);
      }
      for (const { expectation, result } of scenario.assertions) {
        const assertionStatus = result.passed ? '✓' : '✗';
        console.log(`  ${assertionStatus} ${expectation.description}`);
        if (!result.passed) {
          console.log(`    ${result.message}`);
        }
      }
      console.log('');
    }

    console.log('─────────────────────────');
    console.log(`${report.totalPassed}/${report.scenarios.length} scenarios passed`);
    console.log(`Total duration: ${report.totalDurationMs}ms\n`);
  }
}

export class JsonReporter implements Reporter {
  name = 'json';
  private outputPath?: string;

  constructor(outputPath?: string) {
    this.outputPath = outputPath;
  }

  async report(report: EvaluationReport): Promise<void> {
    const output = JSON.stringify(report, null, 2);

    if (this.outputPath) {
      await import('fs').then(fs => fs.promises.writeFile(this.outputPath!, output));
    } else {
      console.log(output);
    }
  }
}

export class JUnitReporter implements Reporter {
  name = 'junit';
  private outputPath?: string;

  constructor(outputPath?: string) {
    this.outputPath = outputPath;
  }

  async report(report: EvaluationReport): Promise<void> {
    const xml = this.generateJUnitXml(report);

    if (this.outputPath) {
      await import('fs').then(fs => fs.promises.writeFile(this.outputPath!, xml));
    } else {
      console.log(xml);
    }
  }

  private generateJUnitXml(report: EvaluationReport): string {
    const testCases = report.scenarios.map(scenario => {
      const failureDetails = scenario.assertions
        .filter(a => !a.result.passed)
        .map(a => `  <failure message="${this.escapeXml(a.expectation.description)}">${this.escapeXml(a.result.message)}</failure>`)
        .join('\n');

      const passed = scenario.passed ? '' : failureDetails;

      return `    <testcase name="${this.escapeXml(scenario.name)}" classname="wallbit.agent.eval" time="${(scenario.durationMs / 1000).toFixed(3)}">
${passed}
    </testcase>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="Wallbit Agent Evaluation" tests="${report.scenarios.length}" failures="${report.totalFailed}" time="${(report.totalDurationMs / 1000).toFixed(3)}">
${testCases}
</testsuite>`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&apos;');
  }
}