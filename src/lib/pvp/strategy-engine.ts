// ============================================================================
// PVP 策略引擎 — BattleState → StrategyDecision
// 使用 DeepSeek V4 Flash 的深度推理能力进行战局分析
// ============================================================================

import { senseNovaChat, senseNovaChatStream } from './sensenova-provider';
import type { BattleState, StrategyDecision, Skill } from './types';

/**
 * 策略分析 System Prompt
 */
const STRATEGY_SYSTEM_PROMPT = `
你是一个《洛克王国》PVP 对战策略大师。你的任务是基于当前战局状态，选择最优行动。

《洛克王国》回合制对战核心规则：
1. 每回合双方各选择一个行动，速度快的先出手
2. 技能有属性克制：火克草、草克水、水克火，等等
3. 先手技能（priority > 0）优先于普通技能
4. 换宠会消耗一回合，但可以规避属性劣势
5. 防守可以减少受到的伤害

分析流程：
1. 【速度判断】比较双方宠物速度，判断谁先手
2. 【属性克制】分析双方属性克制关系
3. 【斩杀线】判断当前技能是否可以直接击杀对手
4. 【风险对冲】考虑对手可能的选择（换宠/先手技能）
5. 【换宠评估】当前宠物是否处于劣势，是否需要换宠
6. 【最终决策】从所有可行方案中选择最优

输出 JSON 格式决策：
{
  "action": "skill" | "switch" | "defend" | "wait",
  "target": "技能名称/宠物名称",
  "target_coords": [点击的x坐标, 点击的y坐标],
  "reason": "详细决策理由，包含分析过程",
  "confidence": 0.0-1.0,
  "alternatives": [
    {
      "action": "skill",
      "target": "备选技能",
      "reason": "备选理由",
      "confidence": 0.0-1.0
    }
  ],
  "risk_assessment": {
    "worst_case": "最坏情况描述",
    "worst_case_hp": 最坏情况后我方剩余HP百分比,
    "best_case": "最佳情况描述",
    "best_case_hp": 最佳情况后我方剩余HP百分比
  }
}

决策优先级：
1. 能直接击杀 → 优先击杀
2. 属性克制优势 → 使用克制技能
3. 属性劣势且无法反制 → 考虑换宠
4. 不确定对手行动 → 选择保守方案
5. 状态异常 → 优先解除或换宠

只返回 JSON，不要任何额外文字。
`;

/**
 * 屏幕坐标映射表
 * 根据《洛克王国》手游实际UI布局，将逻辑位置映射到屏幕坐标
 */
const SCREEN_COORDS: Record<string, Record<string, [number, number]>> = {
  skill: {
    'skill1': [200, 1600],
    'skill2': [600, 1600],
    'skill3': [200, 1850],
    'skill4': [600, 1850],
  },
  switch: {
    'switch_btn': [900, 1750],
  },
  defend: {
    'defend_btn': [900, 1600],
  },
  match: {
    'confirm': [540, 1600],
    'start_match': [540, 1400],
  },
};

function getSkillCoords(skillName: string, skills: Skill[]): [number, number] {
  const idx = skills.findIndex(s => s.name === skillName);
  if (idx >= 0 && idx < 4) {
    return SCREEN_COORDS.skill[`skill${idx + 1}`];
  }
  return SCREEN_COORDS.skill.skill1;
}

/**
 * 核心决策函数
 */
export async function decideAction(
  state: BattleState,
  onThinking?: (line: string) => void,
): Promise<StrategyDecision> {
  const stateForModel = {
    scene: state.scene,
    round: state.round,
    turn: state.turn,
    my_pet: {
      name: state.my_pet.name,
      hp: state.my_pet.hp,
      max_hp: state.my_pet.max_hp,
      status: state.my_pet.status,
      buffs: state.my_pet.buffs,
      available_skills: state.my_pet.available_skills.map(s => ({
        name: s.name,
        type: s.type,
        power: s.power,
        priority: s.priority,
        pp: s.pp,
        max_pp: s.max_pp,
        category: s.category,
        accuracy: s.accuracy,
      })),
      type: state.my_pet.type,
    },
    enemy_pet: {
      name: state.enemy_pet.name,
      hp: state.enemy_pet.hp,
      max_hp: state.enemy_pet.max_hp,
      status: state.enemy_pet.status,
      buffs: state.enemy_pet.buffs,
      type: state.enemy_pet.type,
    },
    weather: state.weather,
    field: state.field,
    last_my_action: state.last_my_action,
    last_enemy_action: state.last_enemy_action,
    history: state.history.slice(-5),
  };

  if (onThinking) {
    return await decideActionStreaming(stateForModel, state, onThinking);
  } else {
    return await decideActionDirect(stateForModel, state);
  }
}

async function decideActionDirect(stateForModel: any, originalState: BattleState): Promise<StrategyDecision> {
  const response = await senseNovaChat({
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: STRATEGY_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(stateForModel, null, 2) },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    reasoning_effort: 'high',
    temperature: 0.3,
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('策略引擎返回为空');
  
  const decision = JSON.parse(content) as StrategyDecision;
  return enrichDecision(decision, originalState);
}

async function decideActionStreaming(
  stateForModel: any,
  originalState: BattleState,
  onThinking: (line: string) => void,
): Promise<StrategyDecision> {
  let fullText = '';

  try {
    const stream = senseNovaChatStream({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: STRATEGY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(stateForModel, null, 2) },
      ],
      reasoning_effort: 'high',
      max_tokens: 4096,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'reasoning') {
        onThinking(chunk.content);
      } else if (chunk.type === 'text') {
        fullText += chunk.content;
      }
    }

    const decision = JSON.parse(fullText) as StrategyDecision;
    return enrichDecision(decision, originalState);
  } catch (error) {
    console.error('[StrategyEngine] 流式决策失败，回退到非流式:', error);
    return decideActionDirect(stateForModel, originalState);
  }
}

function enrichDecision(decision: StrategyDecision, state: BattleState): StrategyDecision {
  const enriched = { ...decision };
  if (!enriched.target_coords || enriched.target_coords[0] === 0) {
    if (enriched.action === 'skill') {
      enriched.target_coords = getSkillCoords(enriched.target, state.my_pet.available_skills);
    } else if (enriched.action === 'switch') {
      enriched.target_coords = SCREEN_COORDS.switch.switch_btn;
    } else if (enriched.action === 'defend') {
      enriched.target_coords = SCREEN_COORDS.defend.defend_btn;
    }
  }
  return enriched;
}

/**
 * 快速模式 — 用于低风险局面的简化决策
 */
export async function quickDecide(state: BattleState): Promise<StrategyDecision> {
  const response = await senseNovaChat({
    model: 'sensenova-6.7-flash-lite',
    messages: [
      {
        role: 'system',
        content: `你是一个《洛克王国》PVP 快速决策器。根据当前战局，选择最优技能。
只返回 JSON：{"action":"skill","target":"技能名","reason":"理由","confidence":0-1}
不要任何其他文字。`,
      },
      {
        role: 'user',
        content: `我方：${state.my_pet.name} (HP:${state.my_pet.hp}%) 技能：${state.my_pet.available_skills.map(s => `${s.name}(威力${s.power},PP${s.pp})`).join('、')}
敌方：${state.enemy_pet.name} (HP:${state.enemy_pet.hp}%)
天气：${state.weather}
选择哪个技能？`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500,
    temperature: 0.2,
  });

  const content = response.choices?.[0]?.message?.content;
  const decision = JSON.parse(content) as StrategyDecision;
  return enrichDecision(decision, state);
}
