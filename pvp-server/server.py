# ============================================================================
# 洛克王国 PVP AI 代打系统 — 后端 API 服务
# 接收手机截图 → 调用 SenseNova → 返回决策
# ============================================================================

import os
import json
import base64
import time
import logging
from io import BytesIO
from datetime import datetime

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

# 配置
SENSENOVA_API_KEY = os.environ.get('SENSENOVA_API_KEY', 'sk-26YXqkZ4xNxn4iWp3UT1ibb8WyUavE8I')
SENSENOVA_BASE_URL = 'https://token.sensenova.cn/v1'
SERVER_PORT = int(os.environ.get('PORT', 8047))
API_AUTH_TOKEN = os.environ.get('API_AUTH_TOKEN', 'rk-pvp-token-2024')

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# 战斗分析 Prompt
# ============================================================================

BATTLE_ANALYSIS_PROMPT = """你是一个《洛克王国》手游战斗分析师。从截图中提取结构化战局信息。

《洛克王国》是一款回合制宠物对战手游。对战双方各派出一只宠物，每回合可以选择技能攻击、换宠、防守或使用道具。

请分析截图并返回 JSON。

字段说明：
{
  "scene": "battle" | "menu" | "matching" | "result" | "unknown",
  "round": 当前回合数(从1开始，不能确定填0),
  "turn": "my" | "enemy" | "waiting",
  "my_pet": {
    "name": "宠物名称",
    "hp": 当前HP百分比(0-100),
    "max_hp": 100,
    "status": ["状态效果，没有则空数组"],
    "buffs": [{"name": "攻击+1", "type": "buff", "value": 1}],
    "available_skills": [
      {"name": "技能名称", "type": "属性", "power": 威力, "priority": 先手值, "pp": 剩余PP, "max_pp": 最大PP, "category": "physical/special/status", "accuracy": 命中率}
    ],
    "type": ["宠物属性"]
  },
  "enemy_pet": { 同上结构 },
  "weather": "当前天气",
  "field": "场地效果",
  "last_my_action": "我上回合行动(可选)",
  "last_enemy_action": "对手上回合行动(可选)",
  "confidence": 自信程度(0-1)
}

重要规则：
1. 只返回 JSON，不要任何额外文字
2. HP 百分比根据血量条长度估算
3. 技能名称根据画面中的文字识别"""

STRATEGY_PROMPT = """你是一个《洛克王国》PVP 对战策略大师。基于当前战局状态，选择最优行动。

回合制对战核心规则：
1. 每回合双方各选一个行动，速度快的先出手
2. 技能有属性克制：火克草、草克水、水克火
3. 先手技能(priority>0)优先于普通技能
4. 换宠消耗一回合，可规避属性劣势
5. 防守可减少受到的伤害

分析流程：
1. 速度判断 → 2. 属性克制 → 3. 斩杀线 → 4. 风险对冲 → 5. 最终决策

输出 JSON：
{
  "action": "skill" | "switch" | "defend" | "wait",
  "target": "技能名称/宠物名称",
  "target_coords": [x, y],
  "reason": "详细决策理由",
  "confidence": 0.0-1.0,
  "alternatives": [{"action": "skill", "target": "备选", "reason": "理由", "confidence": 0.0}],
  "risk_assessment": {"worst_case": "描述", "worst_case_hp": 0, "best_case": "描述", "best_case_hp": 100}
}

决策优先级：
1. 能直接击杀 → 优先击杀
2. 属性克制优势 → 使用克制技能
3. 属性劣势无法反制 → 考虑换宠
4. 不确定对手行动 → 选择保守方案

只返回 JSON，不要任何额外文字。"""

# ============================================================================
# SenseNova API 调用
# ============================================================================

def call_sensenova(messages, model='sensenova-6.7-flash-lite', response_format=None, max_tokens=4096, temperature=0.1, reasoning_effort=None):
    """调用 SenseNova API"""
    payload = {
        'model': model,
        'messages': messages,
        'max_tokens': max_tokens,
        'temperature': temperature,
    }
    if response_format:
        payload['response_format'] = response_format
    if reasoning_effort:
        payload['reasoning_effort'] = reasoning_effort
    
    resp = requests.post(
        f'{SENSENOVA_BASE_URL}/chat/completions',
        headers={
            'Authorization': f'Bearer {SENSENOVA_API_KEY}',
            'Content-Type': 'application/json',
        },
        json=payload,
        timeout=120,
    )
    
    if resp.status_code != 200:
        raise Exception(f'SenseNova API error ({resp.status_code}): {resp.text[:500]}')
    
    return resp.json()

def call_sensenova_stream(model, messages, reasoning_effort=None):
    """流式调用 SenseNova API，返回生成器"""
    payload = {
        'model': model,
        'messages': messages,
        'stream': True,
        'stream_options': {'include_usage': True},
        'max_tokens': 4096,
    }
    if reasoning_effort:
        payload['reasoning_effort'] = reasoning_effort
    
    resp = requests.post(
        f'{SENSENOVA_BASE_URL}/chat/completions',
        headers={
            'Authorization': f'Bearer {SENSENOVA_API_KEY}',
            'Content-Type': 'application/json',
        },
        json=payload,
        stream=True,
        timeout=120,
    )
    
    if resp.status_code != 200:
        raise Exception(f'SenseNova stream error ({resp.status_code}): {resp.text[:500]}')
    
    return resp.iter_lines()

# ============================================================================
# API 端点
# ============================================================================

@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

@app.route('/v1/analyze', methods=['POST'])
def analyze_battle():
    """
    分析战局截图
    输入：{"image": "base64编码的截图", "stream": true/false}
    输出：{"battle_state": {...}, "thinking": [...]}
    """
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({'error': 'missing image'}), 400
    
    # 验证图片大小
    image_b64 = data['image']
    if len(image_b64) > 10 * 1024 * 1024:  # 10MB
        return jsonify({'error': 'image too large'}), 400
    
    logger.info(f'收到截图分析请求, 大小: {len(image_b64)} bytes')
    
    try:
        # 调用 SenseNova 多模态模型分析战局
        result = call_sensenova(
            messages=[
                {'role': 'system', 'content': BATTLE_ANALYSIS_PROMPT},
                {'role': 'user', 'content': [
                    {'type': 'text', 'text': '分析当前《洛克王国》PVP 战局截图，返回 JSON。'},
                    {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{image_b64}'}},
                ]},
            ],
            model='sensenova-6.7-flash-lite',
            response_format={'type': 'json_object'},
            max_tokens=4096,
            temperature=0.1,
        )
        
        content = result['choices'][0]['message']['content']
        battle_state = json.loads(content)
        
        logger.info(f'战局分析完成: scene={battle_state.get("scene")}, '
                    f'我方={battle_state.get("my_pet", {}).get("name")} '
                    f'HP={battle_state.get("my_pet", {}).get("hp")}%, '
                    f'敌方={battle_state.get("enemy_pet", {}).get("name")} '
                    f'HP={battle_state.get("enemy_pet", {}).get("hp")}%')
        
        return jsonify({
            'success': True,
            'battle_state': battle_state,
            'usage': result.get('usage', {}),
        })
        
    except Exception as e:
        logger.error(f'战局分析失败: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/v1/decide', methods=['POST'])
def decide_action():
    """
    策略决策
    输入：{"battle_state": {...}, "stream": true/false}
    输出：{"decision": {...}, "thinking": [...]}
    """
    data = request.get_json()
    if not data or 'battle_state' not in data:
        return jsonify({'error': 'missing battle_state'}), 400
    
    battle_state = data['battle_state']
    use_stream = data.get('stream', False)
    
    logger.info(f'收到策略决策请求, stream={use_stream}')
    
    try:
        # 准备发送给模型的状态
        state_for_model = {
            'scene': battle_state.get('scene'),
            'round': battle_state.get('round', 0),
            'turn': battle_state.get('turn', 'waiting'),
            'my_pet': {
                'name': battle_state.get('my_pet', {}).get('name', '未知'),
                'hp': battle_state.get('my_pet', {}).get('hp', 0),
                'max_hp': battle_state.get('my_pet', {}).get('max_hp', 100),
                'status': battle_state.get('my_pet', {}).get('status', []),
                'buffs': battle_state.get('my_pet', {}).get('buffs', []),
                'available_skills': battle_state.get('my_pet', {}).get('available_skills', []),
                'type': battle_state.get('my_pet', {}).get('type', ['普通']),
            },
            'enemy_pet': {
                'name': battle_state.get('enemy_pet', {}).get('name', '未知'),
                'hp': battle_state.get('enemy_pet', {}).get('hp', 0),
                'max_hp': battle_state.get('enemy_pet', {}).get('max_hp', 100),
                'status': battle_state.get('enemy_pet', {}).get('status', []),
                'buffs': battle_state.get('enemy_pet', {}).get('buffs', []),
                'type': battle_state.get('enemy_pet', {}).get('type', ['普通']),
            },
            'weather': battle_state.get('weather', '无'),
            'field': battle_state.get('field', '无'),
        }
        
        # 使用 DeepSeek V4 Flash 做深度推理
        result = call_sensenova(
            messages=[
                {'role': 'system', 'content': STRATEGY_PROMPT},
                {'role': 'user', 'content': json.dumps(state_for_model, ensure_ascii=False, indent=2)},
            ],
            model='deepseek-v4-flash',
            response_format={'type': 'json_object'},
            max_tokens=4096,
            temperature=0.3,
            reasoning_effort='high',
        )
        
        content = result['choices'][0]['message']['content']
        reasoning = result['choices'][0]['message'].get('reasoning_content', '')
        decision = json.loads(content)
        
        logger.info(f'策略决策完成: action={decision.get("action")} target={decision.get("target")} '
                    f'confidence={decision.get("confidence")}')
        
        # 将 reasoning 拆成行
        thinking_lines = [line.strip() for line in reasoning.split('\n') if line.strip()] if reasoning else []
        
        return jsonify({
            'success': True,
            'decision': decision,
            'thinking': thinking_lines,
            'usage': result.get('usage', {}),
        })
        
    except Exception as e:
        logger.error(f'策略决策失败: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/v1/full-cycle', methods=['POST'])
def full_cycle():
    """
    完整战斗循环：截图分析 + 策略决策
    输入：{"image": "base64截图"}
    输出：{"battle_state": {...}, "decision": {...}, "thinking": [...]}
    """
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({'error': 'missing image'}), 400
    
    image_b64 = data['image']
    
    try:
        # Step 1: 分析战局
        analyze_result = call_sensenova(
            messages=[
                {'role': 'system', 'content': BATTLE_ANALYSIS_PROMPT},
                {'role': 'user', 'content': [
                    {'type': 'text', 'text': '分析当前《洛克王国》PVP 战局截图，返回 JSON。'},
                    {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{image_b64}'}},
                ]},
            ],
            model='sensenova-6.7-flash-lite',
            response_format={'type': 'json_object'},
            max_tokens=4096,
            temperature=0.1,
        )
        
        battle_state = json.loads(analyze_result['choices'][0]['message']['content'])
        
        # 检查场景
        if battle_state.get('scene') != 'battle':
            return jsonify({
                'success': True,
                'scene': battle_state.get('scene', 'unknown'),
                'battle_state': battle_state,
                'decision': None,
                'thinking': ['场景不是战斗，跳过策略决策'],
            })
        
        # Step 2: 策略决策
        state_for_model = {
            'scene': battle_state.get('scene'),
            'round': battle_state.get('round', 0),
            'turn': battle_state.get('turn', 'waiting'),
            'my_pet': battle_state.get('my_pet', {}),
            'enemy_pet': battle_state.get('enemy_pet', {}),
            'weather': battle_state.get('weather', '无'),
            'field': battle_state.get('field', '无'),
        }
        
        decide_result = call_sensenova(
            messages=[
                {'role': 'system', 'content': STRATEGY_PROMPT},
                {'role': 'user', 'content': json.dumps(state_for_model, ensure_ascii=False, indent=2)},
            ],
            model='deepseek-v4-flash',
            response_format={'type': 'json_object'},
            max_tokens=4096,
            temperature=0.3,
            reasoning_effort='high',
        )
        
        content = decide_result['choices'][0]['message']['content']
        reasoning = decide_result['choices'][0]['message'].get('reasoning_content', '')
        decision = json.loads(content)
        
        thinking_lines = [line.strip() for line in reasoning.split('\n') if line.strip()] if reasoning else []
        
        logger.info(f'完整循环完成: {battle_state.get("my_pet", {}).get("name")} → {decision.get("target")}')
        
        return jsonify({
            'success': True,
            'scene': 'battle',
            'battle_state': battle_state,
            'decision': decision,
            'thinking': thinking_lines,
            'usage': {
                'analyze': analyze_result.get('usage', {}),
                'decide': decide_result.get('usage', {}),
            },
        })
        
    except Exception as e:
        logger.error(f'完整循环失败: {e}')
        return jsonify({'error': str(e)}), 500

# ============================================================================
# 主入口
# ============================================================================

if __name__ == '__main__':
    logger.info(f'启动 PVP AI 服务器, 端口: {SERVER_PORT}')
    logger.info(f'API Key 配置: {SENSENOVA_API_KEY[:8]}...')
    logger.info(f'端点列表:')
    logger.info(f'  POST /v1/analyze     - 分析战局截图')
    logger.info(f'  POST /v1/decide      - 策略决策')
    logger.info(f'  POST /v1/full-cycle  - 完整战斗循环')
    logger.info(f'  GET  /health         - 健康检查')
    app.run(host='0.0.0.0', port=SERVER_PORT, debug=False)