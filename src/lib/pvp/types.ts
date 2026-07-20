// ============================================================================
// 洛克王国 PVP AI 代打系统 — 核心类型定义
// Rock Kingdom PVP AI Agent — Core Type Definitions
// ============================================================================

/** 场景类型 */
export type PvPScene = 
  | 'menu'        // 主菜单/游戏大厅
  | 'matching'    // 匹配中
  | 'battle'      // 战斗中
  | 'result'      // 战斗结果
  | 'unknown';    // 未识别

/** 行动方 */
export type TurnOwner = 'my' | 'enemy' | 'waiting';

/** 状态效果 */
export type StatusEffect = string; // "烧伤" | "睡眠" | "冰冻" | ...

/** 增益/减益 */
export interface Buff {
  name: string;      // "攻击+1"
  type: 'buff' | 'debuff';
  value: number;     // +1, -2, etc.
}

/** 技能 */
export interface Skill {
  name: string;
  type: string;         // "火" | "水" | "草" | "普通" | ...
  power: number;
  priority: number;     // 先手值
  pp: number;           // 剩余PP
  max_pp: number;
  category: 'physical' | 'special' | 'status';
  accuracy: number;     // 0-100
  description?: string;
  effects?: string[];   // ["烧伤", "降防"]
}

/** 宠物 */
export interface Pet {
  name: string;
  hp: number;           // 当前HP（百分比 0-100）
  max_hp: number;       // 最大HP（百分比 100）
  level?: number;
  status: StatusEffect[];
  buffs: Buff[];
  available_skills: Skill[];
  type: string[];       // ["火", "飞行"]
}

/** 单回合记录 */
export interface RoundRecord {
  round: number;
  my_action: string;
  enemy_action: string;
  my_hp_after: number;
  enemy_hp_after: number;
  damage_dealt: number;
  damage_taken: number;
  description: string;
}

/** 完整战局状态 — 核心数据结构，所有模块只处理这个 */
export interface BattleState {
  scene: PvPScene;
  round: number;
  turn: TurnOwner;
  
  my_pet: Pet;
  enemy_pet: Pet;
  
  // 后备宠物（如果有）
  my_bench?: Pet[];
  enemy_bench?: Pet[];
  
  // 环境
  weather: string;
  field: string;
  
  // 历史上下文
  last_my_action?: string;
  last_enemy_action?: string;
  history: RoundRecord[];
  
  // 元数据
  raw_timestamp: number;
  confidence: number;  // 状态解析置信度 0-1
}

/** 策略决策 */
export interface StrategyDecision {
  action: 'skill' | 'switch' | 'defend' | 'item' | 'wait';
  target: string;           // 技能名 / 宠物名 / "defend"
  target_coords: [number, number];  // 屏幕坐标
  reason: string;           // 详细决策理由
  confidence: number;       // 0.0 - 1.0
  alternatives?: Array<{
    action: string;
    target: string;
    reason: string;
    confidence: number;
  }>;
  risk_assessment: {
    worst_case: string;
    worst_case_hp: number;
    best_case: string;
    best_case_hp: number;
  };
}

/** 战斗循环状态 */
export enum BattleLoopPhase {
  IDLE = 'idle',
  ENTER_GAME = 'enter_game',
  NAVIGATE_PVP = 'navigate_pvp',
  MATCHING = 'matching',
  CAPTURE = 'capture',
  PARSE = 'parse',
  THINK = 'think',
  DISPLAY = 'display',
  COUNTDOWN = 'countdown',
  EXECUTE = 'execute',
  WAIT_ANIMATION = 'wait_animation',
  CHECK_RESULT = 'check_result',
  END = 'end',
  ERROR = 'error',
}

/** HUD 弹幕消息 */
export interface BulletMessage {
  id: string;
  type: 'state' | 'analysis' | 'decision' | 'countdown' | 'action' | 'error';
  content: string;
  timestamp: number;
  severity?: 'info' | 'warning' | 'critical';
}

/** 战斗日志记录 */
export interface BattleLog {
  id: string;
  timestamp: string;
  result: 'win' | 'loss' | 'draw' | 'error' | 'unknown';
  rounds: number;
  my_team: string[];
  enemy_team: string[];
  decisions: StrategyDecision[];
  states: BattleState[];
  summary: string;
}