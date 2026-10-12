import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { Scenario } from '../types.js';

interface YamlScenario {
  id: string;
  name: string;
  description: string;
  category: string;
  prompt: string;
  setup: {
    trade?: {
      failure?: string;
      statusCode?: number;
      retryAfter?: number;
    };
    operation?: {
      failure?: string;
      statusCode?: number;
      retryAfter?: number;
    };
    api?: {
      behaviors?: Record<string, any>;
    };
  };
  expectedBehavior: string[];
  forbiddenBehavior: string[];
  expectations: Array<{
    type: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
  }>;
  severity: 'critical' | 'high' | 'medium' | 'low';
  timeoutMs?: number;
}

function mapApiBehavior(config: YamlScenario['setup']['trade'] | YamlScenario['setup']['operation'] | undefined): Record<string, any> | undefined {
  if (!config) return undefined;
  const behavior: Record<string, any> = {};
  if (config.failure) behavior['type'] = config.failure;
  if (config.statusCode) behavior['statusCode'] = config.statusCode;
  if (config.retryAfter) behavior['retryAfter'] = config.retryAfter;
  return Object.keys(behavior).length > 0 ? behavior : undefined;
}

function mapExpectation(exp: YamlScenario['expectations'][0]): any {
  return {
    type: exp.type,
    description: exp.description,
    severity: exp.severity
  };
}

export function loadScenarioFromYaml(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf-8');
  const yamlScenario = yaml.parse(content) as YamlScenario;

  const setup: any = {};
  if (yamlScenario.setup.trade) setup.trade = mapApiBehavior(yamlScenario.setup.trade);
  if (yamlScenario.setup.operation) setup.operation = mapApiBehavior(yamlScenario.setup.operation);

  const apiBehaviors: Record<string, any> = {};
  if (yamlScenario.setup.api?.behaviors) {
    Object.assign(apiBehaviors, yamlScenario.setup.api.behaviors);
  }

  const scenario = {
    id: yamlScenario.id,
    name: yamlScenario.name,
    description: yamlScenario.description,
    category: yamlScenario.category,
    prompt: yamlScenario.prompt,
    setup,
    expectedBehavior: yamlScenario.expectedBehavior,
    forbiddenBehavior: yamlScenario.forbiddenBehavior,
    expectations: yamlScenario.expectations.map(mapExpectation),
    severity: yamlScenario.severity,
    timeoutMs: yamlScenario.timeoutMs || 30000
  };

  return scenario;
}

export function loadScenariosFromDirectory(dirPath: string): any[] {
  const scenarios: any[] = [];
  if (!fs.existsSync(dirPath)) return scenarios;

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    try {
      const scenario = loadScenarioFromYaml(path.join(dirPath, file));
      scenarios.push(scenario);
    } catch (error) {
      console.warn(`Failed to load scenario from ${file}:`, error);
    }
  }
  return scenarios;
}

export function loadScenario(filePath: string): any {
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    return loadScenarioFromYaml(filePath);
  }
  if (filePath.endsWith('.json')) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }
  throw new Error(`Unsupported scenario file format: ${filePath}`);
}