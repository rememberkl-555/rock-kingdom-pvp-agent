// ============================================================================
// 战斗循环控制器 — 核心状态机
// 管理整个 PVP 自动对战的完整生命周期
// ============================================================================

import { parseBattleState, quickSceneClassify } from './battle-state-parser';
import { decideAction, quickDecide } from './strategy-engine';
import type { BattleState, StrategyDecision, BattleLog, PvPScene } from './types';
import { BattleLoopPhase } from './types';

/**
 * 截图函数 — 调用 Mobile-Agent 的截图能力
 */
export async function captureScreenshot(): Promise<string> {
  // TODO: 对接 Mobile-Agent 的截图工具
  throw new Error('截图功能需要对接 Mobile-Agent 的截图工具');
}

/**
 * 点击执行函数 — 调用 ADB 或无障碍点击
 */
export async function executeClick(coords: [number, number]): Promise<void> {
  // TODO: 对接 Mobile-Agent 的点击工具
  console.log(`[BattleLoop] 点击: (${coords[0]}, ${coords[1]})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 战斗循环控制器
 */
export class BattleController {
  private phase: BattleLoopPhase = BattleLoopPhase.IDLE;
  private battleState: BattleState | null = null;
  private decision: StrategyDecision | null = null;
  private thinkingStream: string[] = [];
  private countdown: number = 0;
  private battleLog: BattleLog | null = null;
  private abortFlag: boolean = false;
  private isRunning: boolean = false;

  // 回调函数
  public onPhaseChange?: (phase: BattleLoopPhase) => void;
  public onBattleStateUpdate?: (state: BattleState) => void;
  public onDecisionUpdate?: (decision: StrategyDecision) => void;
  public onThinkingUpdate?: (line: string) => void;
  public onCountdownUpdate?: (count: number) => void;
  public onLogUpdate?: (log: BattleLog) => void;
  public onError?: (error: Error) => void;

  getPhase(): BattleLoopPhase { return this.phase; }
  getBattleState(): BattleState | null { return this.battleState; }
  getDecision(): StrategyDecision | null { return this.decision; }
  getThinkingStream(): string[] { return [...this.thinkingStream]; }
  getCountdown(): number { return this.countdown; }
  getIsRunning(): boolean { return this.isRunning; }

  /**
   * 开始战斗循环
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[BattleLoop] 战斗循环已在运行中');
      return;
    }
    this.isRunning = true;
    this.abortFlag = false;
    this.thinkingStream = [];

    try {
      await this.runMainLoop();
    } catch (error) {
      console.error('[BattleLoop] 战斗循环异常终止:', error);
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isRunning = false;
      this.setPhase(BattleLoopPhase.IDLE);
    }
  }

  /**
   * 停止战斗循环
   */
  stop(): void {
    this.abortFlag = true;
    this.isRunning = false;
    this.setPhase(BattleLoopPhase.IDLE);
  }

  /**
   * 主循环
   */
  private async runMainLoop(): Promise<void> {
    this.setPhase(BattleLoopPhase.ENTER_GAME);
    let loopCount = 0;
    const MAX_LOOPS = 200;

    while (!this.abortFlag && loopCount < MAX_LOOPS) {
      loopCount++;

      // 1. CAPTURE: 截图
      this.setPhase(BattleLoopPhase.CAPTURE);
      let screenshot: string;
      try {
        screenshot = await captureScreenshot();
      } catch (e) {
        console.warn('[BattleLoop] 截图失败，等待重试:', e);
        await sleep(2000);
        continue;
      }

      // 2. 快速场景识别
      const scene = await quickSceneClassify(screenshot);

      // 3. 根据场景导航
      if (scene === 'menu') {
        this.setPhase(BattleLoopPhase.NAVIGATE_PVP);
        this.addThinking('📋 检测到主菜单，正在导航到 PVP 入口');
        await this.navigateToPvP();
        continue;
      }

      if (scene === 'matching') {
        this.setPhase(BattleLoopPhase.MATCHING);
        this.addThinking('⏳ 匹配中，等待对手...');
        await sleep(3000);
        continue;
      }

      if (scene === 'result') {
        this.setPhase(BattleLoopPhase.CHECK_RESULT);
        await this.handleResult();
        break;
      }

      if (scene === 'unknown') {
        this.addThinking('❓ 无法识别场景，等待...');
        await sleep(2000);
        continue;
      }

      // 4. PARSE: 完整战局解析
      this.setPhase(BattleLoopPhase.PARSE);
      this.addThinking('🔍 分析战局...');
      this.battleState = await parseBattleState(screenshot);
      this.onBattleStateUpdate?.(this.battleState);

      this.addThinking(`📊 我方：${this.battleState.my_pet.name} HP:${this.battleState.my_pet.hp}%`);
      this.addThinking(`📊 敌方：${this.battleState.enemy_pet.name} HP:${this.battleState.enemy_pet.hp}%`);
      this.addThinking(`🌤 天气：${this.battleState.weather}`);

      // 5. THINK: 策略决策
      this.setPhase(BattleLoopPhase.THINK);
      this.addThinking('🧠 正在思考策略...');
      this.decision = await decideAction(this.battleState, (line) => {
        this.addThinking(line);
      });
      this.onDecisionUpdate?.(this.decision);

      this.addThinking(`🎯 决策：${this.decision.action} → ${this.decision.target}`);
      this.addThinking(`💡 理由：${this.decision.reason}`);
      this.addThinking(`📈 置信度：${(this.decision.confidence * 100).toFixed(0)}%`);

      // 6. DISPLAY: HUD 展示
      this.setPhase(BattleLoopPhase.DISPLAY);
      await sleep(500);

      // 7. COUNTDOWN: 倒计时
      this.setPhase(BattleLoopPhase.COUNTDOWN);
      for (let i = 3; i > 0; i--) {
        if (this.abortFlag) return;
        this.countdown = i;
        this.onCountdownUpdate?.(i);
        this.addThinking(`⏱ ${i}...`);
        await sleep(1000);
      }

      // 8. EXECUTE: 点击执行
      this.setPhase(BattleLoopPhase.EXECUTE);
      this.addThinking(`👆 点击：${this.decision.target} (${this.decision.target_coords[0]}, ${this.decision.target_coords[1]})`);
      try {
        await executeClick(this.decision.target_coords);
        this.addThinking('✅ 点击完成');
      } catch (e) {
        this.addThinking(`❌ 点击失败: ${e}`);
      }

      // 9. WAIT: 等待动画
      this.setPhase(BattleLoopPhase.WAIT_ANIMATION);
      this.addThinking('⏳ 等待动画播放...');
      await sleep(3000);
    }

    if (loopCount >= MAX_LOOPS) {
      this.addThinking('⚠️ 达到最大循环次数，自动停止');
      this.setPhase(BattleLoopPhase.END);
    }
  }

  private async navigateToPvP(): Promise<void> {
    this.addThinking('🗺️ 正在导航到 PVP 界面...');
    await sleep(2000);
  }

  private async handleResult(): Promise<void> {
    this.addThinking('🏁 战斗结束！');
    await sleep(3000);
    try { await executeClick([540, 1600]); } catch {}
    this.setPhase(BattleLoopPhase.END);
  }

  private addThinking(line: string) {
    this.thinkingStream.push(line);
    this.onThinkingUpdate?.(line);
    if (this.thinkingStream.length > 100) {
      this.thinkingStream.splice(0, 50);
    }
  }

  private setPhase(phase: BattleLoopPhase) {
    this.phase = phase;
    this.onPhaseChange?.(phase);
  }
}

// 单例导出
let globalController: BattleController | null = null;

export function getBattleController(): BattleController {
  if (!globalController) {
    globalController = new BattleController();
  }
  return globalController;
}