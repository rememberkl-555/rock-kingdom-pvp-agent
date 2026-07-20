import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, SafeAreaView } from 'react-native';
import { PvPHud } from '../../components/pvp/PvPHud';
import { BattleController, getBattleController } from '../../lib/pvp/battle-loop';
import { BattleLoopPhase } from '../../lib/pvp/types';
import type { BattleState, StrategyDecision } from '../../lib/pvp/types';

export default function PvPPage() {
  const controller = getBattleController();
  
  const [phase, setPhase] = useState<BattleLoopPhase>(BattleLoopPhase.IDLE);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [decision, setDecision] = useState<StrategyDecision | null>(null);
  const [thinkingStream, setThinkingStream] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number>(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    controller.onPhaseChange = (p) => setPhase(p);
    controller.onBattleStateUpdate = (s) => setBattleState(s);
    controller.onDecisionUpdate = (d) => setDecision(d);
    controller.onThinkingUpdate = (line) => {
      setThinkingStream(prev => [...prev, line]);
    };
    controller.onCountdownUpdate = (c) => setCountdown(c);
    controller.onError = (err) => {
      setThinkingStream(prev => [...prev, `\u274c \u9519\u8bef: ${err.message}`]);
    };
    
    // Poll isRunning
    const interval = setInterval(() => {
      setIsRunning(controller.getIsRunning());
    }, 500);
    
    return () => clearInterval(interval);
  }, []);

  const handleStart = useCallback(() => {
    setThinkingStream([]);
    setBattleState(null);
    setDecision(null);
    setCountdown(0);
    controller.start().catch(console.error);
  }, []);

  const handleStop = useCallback(() => {
    controller.stop();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <PvPHud
        phase={phase}
        battleState={battleState}
        decision={decision}
        thinkingStream={thinkingStream}
        countdown={countdown}
        isRunning={isRunning}
        onStart={handleStart}
        onStop={handleStop}
      />
    </SafeAreaView>
  );
}
