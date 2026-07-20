// ============================================================================
// 战局状态解析器 — 截图 → BattleState
// 使用 SenseNova 6.7 Flash-Lite 多模态模型分析游戏画面
// ============================================================================

import { senseNovaChat } from './sensenova-provider';
import type { BattleState, PvPScene, TurnOwner, Pet, Skill, RoundRecord } from './types';

/**
 * 战局分析 System Prompt
 * 告诉模型如何解析《洛克王国》PVP 画面
 */
const BATTLE_ANALYSIS_SYSTEM_PROMPT = `
你是一个《洛克王国》手游战斗分析师。你的任务是从游戏截图中提取结构化战局信息。

《洛克王国》是一款回合制宠物对战手游。对战双方各派出一只宠物，每回合可以选择技能攻击、换宠、防守或使用道具。

请分析截图并返回 JSON 格式的当前战局状态。

字段说明：
{
  "scene": "battle" | "menu" | "matching" | "result" | "unknown",
  "round": 当前回合数（从1开始，不能确定就填0）,
  "turn": "my" | "enemy" | "waiting"（当前轮到谁行动）,
  "my_pet": {
    "name": "宠物名称（如"火神"）",
    "hp": 当前HP百分比(0-100),
    "max_hp": 最大HP(100),
    "level": 等级（可选）,
    "status": ["状态效果列表，如"烧伤"、"睡眠"、"冰冻"，没有则空数组],
    "buffs": [{"name": "攻击+1", "type": "buff", "value": 1}],
    "available_skills": [
      {
        "name": "技能名称",
        "type": "属性（火/水/草/普通/飞行/电/冰/超能/格斗/毒/地面/岩石/虫/幽灵/钢/龙/恶/妖精）",
        "power": 威力数值,
        "priority": 先手值（通常正数先手，负数后手，0为正常）,
        "pp": 剩余PP,
        "max_pp": 最大PP,
        "category": "physical" | "special" | "status",
        "accuracy": 命中率(0-100),
        "effects": ["可能附加的效果"]
      }
    ],
    "type": ["宠物属性，如"火"]
  },
  "enemy_pet": { 同上结构 },
  "weather": "当前天气，如"晴天"、"暴雨"、"沙暴"，无天气则为"无"",
  "field": "当前场地效果，无则为"无"",
  "last_my_action": "我上一回合行动（可选）",
  "last_enemy_action": "对手上一回合行动（可选）",
  "confidence": 你对分析结果的自信程度(0-1)
}

重要规则：
1. 只返回 JSON，不要任何额外文字
2. 如果无法识别画面内容，scene 设为 "unknown"，confidence 设为 0
3. HP 百分比根据血量条长度估算
4. 技能名称根据画面中的文字识别
5. 如果看到战斗结算界面，scene 设为 "result"
6. 如果看到匹配等待界面，scene 设为 "matching"
7. 如果看到主菜单/大厅，scene 设为 "menu"
`;

/**
 * 将截图解析为结构化战局状态
 * @param screenshotBase64 Base64 编码的截图
 * @returns 结构化 BattleState
 */
export async function parseBattleState(screenshotBase64: string): Promise<BattleState> {
  try {
    const response = await senseNovaChat({
      model: 'sensenova-6.7-flash-lite',
      messages: [
        { role: 'system', content: BATTLE_ANALYSIS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '分析当前《洛克王国》PVP 战局截图，返回 JSON。' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshotBase64}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      temperature: 0.1, // 低温度确保解析一致性
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('模型返回为空');
    }

    const parsed = JSON.parse(content) as BattleState;
    
    // 验证必要字段
    return {
      scene: parsed.scene || 'unknown',
      round: parsed.round ?? 0,
      turn: parsed.turn || 'waiting',
      my_pet: parsed.my_pet || {
        name: '未知',
        hp: 0,
        max_hp: 100,
        status: [],
        buffs: [],
        available_skills: [],
        type: ['普通'],
      },
      enemy_pet: parsed.enemy_pet || {
        name: '未知',
        hp: 0,
        max_hp: 100,
        status: [],
        buffs: [],
        available_skills: [],
        type: ['普通'],
      },
      weather: parsed.weather || '无',
      field: parsed.field || '无',
      last_my_action: parsed.last_my_action,
      last_enemy_action: parsed.last_enemy_action,
      history: parsed.history || [],
      raw_timestamp: Date.now(),
      confidence: parsed.confidence ?? 0.5,
    };
  } catch (error) {
    // 解析失败时返回一个安全的默认状态
    console.error('[BattleStateParser] 解析失败:', error);
    return {
      scene: 'unknown',
      round: 0,
      turn: 'waiting',
      my_pet: {
        name: '解析失败',
        hp: 0,
        max_hp: 100,
        status: [],
        buffs: [],
        available_skills: [],
        type: ['普通'],
      },
      enemy_pet: {
        name: '解析失败',
        hp: 0,
        max_hp: 100,
        status: [],
        buffs: [],
        available_skills: [],
        type: ['普通'],
      },
      weather: '无',
      field: '无',
      history: [],
      raw_timestamp: Date.now(),
      confidence: 0,
    };
  }
}

/**
 * 快速场景识别 — 轻量级，只判断场景类型
 * 用于战斗循环中的快速导航决策
 */
export async function quickSceneClassify(screenshotBase64: string): Promise<PvPScene> {
  try {
    const response = await senseNovaChat({
      model: 'sensenova-6.7-flash-lite',
      messages: [
        {
          role: 'system',
          content: '你是一个游戏场景分类器。分析截图，只返回一个词：battle（战斗中）、menu（菜单/大厅）、matching（匹配中）、result（战斗结算）、unknown（未知）。不要任何其他文字。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '当前是什么场景？' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshotBase64}` },
            },
          ],
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const scene = response.choices?.[0]?.message?.content?.trim().toLowerCase() as PvPScene;
    return ['battle', 'menu', 'matching', 'result'].includes(scene) ? scene : 'unknown';
  } catch {
    return 'unknown';
  }
}