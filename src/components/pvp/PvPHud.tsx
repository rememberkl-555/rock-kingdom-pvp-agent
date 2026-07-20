import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { BattleLoopPhase } from '../../lib/pvp/types';
import type { BattleState, StrategyDecision } from '../../lib/pvp/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PHASE_LABELS: Record<string, string> = {
  idle: '\u5f85\u673a',
  enter_game: '\u8fdb\u5165\u6e38\u620f',
  navigate_pvp: '\u5bfc\u822a\u5230PVP',
  matching: '\u5339\u914d\u4e2d',
  capture: '\u622a\u56fe',
  parse: '\u5206\u6790\u6218\u5c40',
  think: '\u7b56\u7565\u601d\u8003',
  display: 'HUD\u5c55\u793a',
  countdown: '\u5012\u8ba1\u65f6',
  execute: '\u6267\u884c\u70b9\u51fb',
  wait_animation: '\u7b49\u5f85\u52a8\u753b',
  check_result: '\u68c0\u67e5\u7ed3\u679c',
  end: '\u6218\u6597\u7ed3\u675f',
  error: '\u9519\u8bef',
};

const PHASE_COLORS: Record<string, string> = {
  idle: '#666', capture: '#3b82f6', parse: '#8b5cf6',
  think: '#f59e0b', display: '#10b981', countdown: '#ef4444',
  execute: '#22c55e', wait_animation: '#06b6d4', end: '#6366f1',
  error: '#dc2626',
};

const HPBar: React.FC<{ hp: number; maxHp: number }> = ({ hp, maxHp }) => {
  const percent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const barColor = percent > 50 ? '#22c55e' : percent > 25 ? '#f59e0b' : '#ef4444';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 60, height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', backgroundColor: barColor, borderRadius: 3 }} />
      </View>
      <Text style={{ color: '#fff', fontSize: 10 }}>{hp}/{maxHp}</Text>
    </View>
  );
};

interface PvPHudProps {
  phase: BattleLoopPhase;
  battleState: BattleState | null;
  decision: StrategyDecision | null;
  thinkingStream: string[];
  countdown: number;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}

export const PvPHud: React.FC<PvPHudProps> = ({
  phase, battleState, decision, thinkingStream, countdown, isRunning, onStart, onStop,
}) => {
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [thinkingStream]);

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', padding: 8 }}>
      {/* Top bar */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PHASE_COLORS[phase] || '#666' }} />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{PHASE_LABELS[phase] || phase}</Text>
        </View>
        <Text style={{ color: '#aaa', fontSize: 12 }}>{isRunning ? '\uD83D\uDFE2 \u8fd0\u884c\u4e2d' : '\u23F8 \u5df2\u505c\u6b62'}</Text>
      </View>

      {/* Battle state panel */}
      {battleState && battleState.scene === 'battle' && (
        <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 8, marginVertical: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{battleState.my_pet.name}</Text>
              <HPBar hp={battleState.my_pet.hp} maxHp={battleState.my_pet.max_hp} />
            </View>
            <Text style={{ color: '#f59e0b', fontSize: 16, fontWeight: 'bold', marginHorizontal: 8 }}>VS</Text>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{battleState.enemy_pet.name}</Text>
              <HPBar hp={battleState.enemy_pet.hp} maxHp={battleState.enemy_pet.max_hp} />
            </View>
          </View>
          <Text style={{ color: '#06b6d4', fontSize: 11, marginTop: 4, textAlign: 'center' }}>\uD83C\uDF24 {battleState.weather}</Text>
        </View>
      )}

      {/* Decision panel */}
      {decision && (
        <View style={{ backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', borderRadius: 8, padding: 8, marginVertical: 4 }}>
          <Text style={{ color: '#10b981', fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>\uD83E\uDD16 AI \u51b3\u7b56</Text>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>\u25B6 {decision.target}</Text>
          <Text style={{ color: '#ccc', fontSize: 12, marginTop: 4, lineHeight: 18 }}>{decision.reason}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <View style={{ width: `${decision.confidence * 100}%`, height: 4, backgroundColor: '#10b981', borderRadius: 2 }} />
            <Text style={{ color: '#10b981', fontSize: 11 }}>{(decision.confidence * 100).toFixed(0)}%</Text>
          </View>
        </View>
      )}

      {/* Bullet screen */}
      <View style={{ flex: 1, marginVertical: 4 }}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 4 }}>
          {thinkingStream.map((line, i) => (
            <Text key={i} style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, lineHeight: 20, paddingVertical: 1, paddingHorizontal: 4 }}>{line}</Text>
          ))}
        </ScrollView>
      </View>

      {/* Countdown overlay */}
      {countdown > 0 && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Text style={{ color: '#ef4444', fontSize: 96, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 }}>{countdown}</Text>
        </View>
      )}

      {/* Control buttons */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
        {!isRunning ? (
          <View onTouchEnd={onStart} style={{ backgroundColor: '#22c55e', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>\u25B6 \u5f00\u59cb\u4ee3\u6253</Text>
          </View>
        ) : (
          <View onTouchEnd={onStop} style={{ backgroundColor: '#ef4444', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>\u23F9 \u505c\u6b62</Text>
          </View>
        )}
      </View>
    </View>
  );
};
