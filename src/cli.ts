import { Command } from 'commander';
import { listScenarios, getScenarioByName, getBuiltinScenarios, loadScenariosFromDirectory } from './scenarios/registry.js';
import { createDriver } from './adapters/AgentDriver.js';
import { createMockServer } from './api/mock-server.js';
import { runScenarios, generateReport } from './evaluation/evaluator.js';
import { TerminalReporter, JsonReporter, JUnitReporter } from './reporters/index.js';

interface RunOptions {
  scenario?: string[];
  agent?: string;
  driver?: string;
  json?: string | boolean;
  junit?: string | boolean;
  verbose?: boolean;
  list?: boolean;
  output?: string;
  format?: 'text' | 'json' | 'junit';
}

const AGENT_PROFILES = [
  'safe',
  'unsafe-retry',
  'approval-bypass',
  'prompt-injection-vulnerable',
  'unauthorized-action',
  'malformed-request',
  'concurrent-duplicate',
  'rate-limit-bad',
  'rate-limit-good'
] as const;

const program = new Command();

program
  .name('wallbit-agent-eval')
  .description('Local evaluation harness for AI agents interacting with Wallbit\'s public financial API')
  .version('0.1.0');

program
  .command('list')
  .description('List all available evaluation scenarios')
  .action(() => {
    const scenarios = getBuiltinScenarios();
    console.log('\nAvailable Scenarios:');
    console.log('═'.repeat(60));
    for (const scenario of scenarios) {
      console.log(`  ${scenario.name}`);
      console.log(`    ${scenario.description}`);
      console.log(`    Category: ${scenario.category} | Severity: ${scenario.severity}`);
      console.log(`    Prompt: ${scenario.prompt}`);
      console.log('');
    }
  });

program
  .command('agents')
  .description('List available agent profiles')
  .action(() => {
    console.log('\nAvailable Agent Profiles:');
    console.log('═'.repeat(60));
    for (const profile of ['safe', 'unsafe-retry', 'approval-bypass', 'prompt-injection-vulnerable', 'unauthorized-action', 'malformed-request', 'concurrent-duplicate', 'rate-limit-bad', 'rate-limit-good']) {
      console.log(`  ${profile}`);
    }
    console.log('');
  });

program
  .command('run')
  .description('Run evaluation scenarios')
  .option('-s, --scenario <name...>', 'Scenario name(s) to run (default: all)')
  .option('-a, --agent <profile>', `Agent profile to test (safe, unsafe-retry, approval-bypass, prompt-injection-vulnerable, unauthorized-action, malformed-request, concurrent-duplicate, rate-limit-bad, rate-limit-good)`, 'safe')
  .option('-d, --driver <type>', 'Driver type (http-client, openclaw)', 'http-client')
  .option('--json [path]', 'Output JSON report (optionally to file)')
  .option('--junit [path]', 'Output JUnit XML report (optionally to file)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options: any) => {
    const agentProfile = options.agent as any;
    const validProfiles = ['safe', 'unsafe-retry', 'approval-bypass', 'prompt-injection-vulnerable', 'unauthorized-action', 'malformed-request', 'concurrent-duplicate', 'rate-limit-bad', 'rate-limit-good'];
    if (!validProfiles.includes(agentProfile)) {
      console.error(`Invalid agent profile: ${options.agent}`);
      console.error(`Valid profiles: safe, unsafe-retry, approval-bypass, prompt-injection-vulnerable, unauthorized-action, malformed-request, concurrent-duplicate, rate-limit-bad, rate-limit-good`);
      process.exit(2);
    }

    if (options.driver && !['http-client', 'openclaw'].includes(options.driver)) {
      console.error(`Invalid driver: ${options.driver}`);
      console.error('Valid drivers: http-client, openclaw');
      process.exit(2);
    }

    if (options.driver === 'openclaw') {
      console.error('OpenClaw driver not yet implemented. Use --driver http-client.');
      process.exit(3);
    }

    const scenariosToRun = options.scenario?.length
      ? options.scenario.map((name: string) => {
          const scenario = getScenarioByName(name);
          if (!scenario) {
            console.error(`Scenario not found: ${name}`);
            process.exit(1);
          }
          return scenario;
        })
      : getBuiltinScenarios();

    console.log(`Agent Profile: ${agentProfile}`);
    console.log(`Driver: ${options.driver || 'http-client'}`);
    console.log(`Running ${scenariosToRun.length} scenario(s)...\n`);

    const { createHttpClientDriver } = await import('./adapters/HttpClientDriver.js');
    const { api: mockApi, server, url } = await createMockServer(0);
    const driver = createHttpClientDriver(url, 'test-key', agentProfile);

    try {
      console.log(`Running ${scenariosToRun.length} scenario(s)...\n`);
      const { runScenarios, generateReport } = await import('./evaluation/evaluator.js');
      const results = await runScenarios(driver, mockApi, scenariosToRun, options.verbose);
      const report = generateReport(results);

      report.metadata.agent = agentProfile;
      report.metadata.driver = options.driver || 'http-client';

      const { TerminalReporter, JsonReporter, JUnitReporter } = await import('./reporters/index.js');
      
      const reporters: Array<{ reporter: any; condition: boolean }> = [
        { reporter: new TerminalReporter(), condition: true },
        { reporter: new JsonReporter(typeof options.json === 'string' ? options.json : undefined), condition: !!options.json },
        { reporter: new JUnitReporter(typeof options.junit === 'string' ? options.junit : undefined), condition: !!options.junit }
      ];

      for (const { reporter, condition } of reporters) {
        if (condition) {
          await reporter.report(report);
        }
      }

      await server.close();
      const exitCode = report.totalFailed > 0 ? 1 : 0;
      process.exitCode = exitCode;
    } catch (error) {
      await server.close();
      console.error('Evaluation failed:', error);
      process.exitCode = 2;
    }
  });

program
  .command('load <path>')
  .description('Load and run scenarios from a YAML/JSON file or directory')
  .option('-a, --agent <profile>', `Agent profile (${['safe', 'unsafe-retry', 'approval-bypass', 'prompt-injection-vulnerable', 'unauthorized-action', 'malformed-request', 'concurrent-duplicate', 'rate-limit-bad', 'rate-limit-good'].join(', ')})`, 'safe')
  .option('-d, --driver <type>', 'Driver type (http-client, openclaw)', 'http-client')
  .option('--json [path]', 'Output JSON report (optionally to file)')
  .option('--junit [path]', 'Output JUnit XML report (optionally to file)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (path: string, options: any) => {
    const { loadScenariosFromDirectory, loadScenario } = await import('./scenarios/loader.js');
    const { runScenarios, generateReport } = await import('./evaluation/evaluator.js');
    const { createMockServer } = await import('./api/mock-server.js');
    const { createHttpClientDriver } = await import('./adapters/HttpClientDriver.js');
    const { TerminalReporter, JsonReporter, JUnitReporter } = await import('./reporters/index.js');

    const agentProfile = options.agent as any;
    const validProfiles = ['safe', 'unsafe-retry', 'approval-bypass', 'prompt-injection-vulnerable', 'unauthorized-action', 'malformed-request', 'concurrent-duplicate', 'rate-limit-bad', 'rate-limit-good'];
    if (!validProfiles.includes(agentProfile)) {
      console.error(`Invalid agent profile: ${options.agent}`);
      process.exit(2);
    }

    let scenarios: any[];
    try {
      const fs = await import('fs');
      const stat = fs.statSync(path);
      if (stat.isDirectory()) {
        scenarios = loadScenariosFromDirectory(path);
      } else {
        scenarios = [loadScenario(path)];
      }
    } catch (error) {
      console.error(`Failed to load scenarios from ${path}:`, error);
      process.exit(1);
    }

    if (scenarios.length === 0) {
      console.error('No scenarios found');
      process.exit(1);
    }

    console.log(`Loaded ${scenarios.length} scenario(s) from ${path}`);
    console.log(`Agent Profile: ${options.agent}`);

    const { api: mockApi, server, url } = await createMockServer(0);
    const driver = createHttpClientDriver(url, 'test-key', agentProfile);

    try {
      const { runScenarios, generateReport } = await import('./evaluation/evaluator.js');
      const { TerminalReporter, JsonReporter, JUnitReporter } = await import('./reporters/index.js');

      const results = await runScenarios(driver, mockApi, scenarios, options.verbose);
      const report = generateReport(results);
      report.metadata.agent = options.agent || 'safe';
      report.metadata.driver = options.driver || 'http-client';

      const reporters = [
        { reporter: new TerminalReporter(), condition: true },
        { reporter: new JsonReporter(typeof options.json === 'string' ? options.json : undefined), condition: !!options.json },
        { reporter: new JUnitReporter(typeof options.junit === 'string' ? options.junit : undefined), condition: !!options.junit }
      ];

      for (const { reporter, condition } of reporters) {
        if (condition) await reporter.report(report);
      }

      await server.close();
      process.exitCode = report.totalFailed > 0 ? 1 : 0;
    } catch (error) {
      await server.close();
      console.error('Evaluation failed:', error);
      process.exitCode = 2;
    }
  });

program.parse();