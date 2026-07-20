#!/bin/bash
# ============================================================================
# 洛克王国 PVP AI 代打系统 — 手机端 Agent 脚本
# 运行在 Android 手机上，通过 ADB 连接
# 循环：截图 → 发送到服务器 → 接收决策 → 点击
# ============================================================================

# 服务器地址（广州腾讯云）
SERVER_URL="http://193.112.187.72:8047"

# 轮询间隔（秒）
SCREENSHOT_INTERVAL=3
CLICK_DELAY=1

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }

# ============================================================================
# 检查工具
# ============================================================================

check_prereqs() {
    local missing=0
    for cmd in curl base64; do
        if ! command -v "$cmd" &>/dev/null; then
            err "缺少命令: $cmd"
            missing=1
        fi
    done
    
    # 检查 screenshot 和 input 命令（Android 原生工具）
    if ! command -v screencap &>/dev/null; then
        warn "screencap 命令不可用，尝试 /system/bin/screencap"
        if [ ! -f /system/bin/screencap ]; then
            err "screencap 不可用，请确保在 Android 环境运行"
            missing=1
        fi
    fi
    
    if [ $missing -eq 1 ]; then
        err "环境检查失败，请修复后重试"
        exit 1
    fi
    
    log "环境检查通过"
}

# ============================================================================
# 截图
# ============================================================================

capture_screenshot() {
    local output_path="/sdcard/pvp_screenshot.png"
    
    # 使用 screencap 截图
    if command -v screencap &>/dev/null; then
        screencap -p "$output_path" 2>/dev/null
    elif [ -f /system/bin/screencap ]; then
        /system/bin/screencap -p "$output_path" 2>/dev/null
    else
        err "无法截图"
        return 1
    fi
    
    # 检查文件是否生成
    if [ ! -f "$output_path" ]; then
        err "截图文件未生成"
        return 1
    fi
    
    # 转成 Base64
    local b64
    b64=$(base64 < "$output_path" | tr -d '\n')
    
    # 清理临时文件
    rm -f "$output_path"
    
    echo "$b64"
}

# ============================================================================
# 发送到服务器
# ============================================================================

send_to_server() {
    local image_b64="$1"
    local endpoint="$2"
    
    local payload
    payload=$(cat << EOF
{"image": "${image_b64}"}
EOF
)
    
    local result
    result=$(curl -s -X POST "${SERVER_URL}${endpoint}" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --connect-timeout 30 \
        --max-time 120 2>&1)
    
    local curl_exit=$?
    if [ $curl_exit -ne 0 ]; then
        err "服务器请求失败 (exit=$curl_exit): $result"
        return 1
    fi
    
    echo "$result"
}

# ============================================================================
# 点击执行
# ============================================================================

execute_tap() {
    local x="$1"
    local y="$2"
    
    if command -v input &>/dev/null; then
        input tap "$x" "$y" 2>/dev/null
    elif [ -f /system/bin/input ]; then
        /system/bin/input tap "$x" "$y" 2>/dev/null
    else
        err "input 命令不可用"
        return 1
    fi
    
    log "点击: ($x, $y)"
}

# ============================================================================
# 显示思考过程
# ============================================================================

show_thinking() {
    local thinking_text="$1"
    
    # 将 thinking 按行拆分显示
    echo "$thinking_text" | while IFS= read -r line; do
        if [ -n "$line" ]; then
            info "🧠 $line"
        fi
    done
}

# ============================================================================
# 主循环
# ============================================================================

main_loop() {
    local round=0
    local max_rounds=100
    
    log "=========================================="
    log "洛克王国 PVP AI 代打系统"
    log "服务器: $SERVER_URL"
    log "=========================================="
    log ""
    
    # 测试服务器连接
    info "测试服务器连接..."
    local health
    health=$(curl -s "${SERVER_URL}/health" --connect-timeout 10 2>&1)
    if ! echo "$health" | grep -q '"ok"'; then
        err "服务器连接失败: $health"
        exit 1
    fi
    log "✅ 服务器连接正常"
    log ""
    
    while [ $round -lt $max_rounds ]; do
        round=$((round + 1))
        log "══════════════════════════════════════"
        log "回合 $round"
        log "══════════════════════════════════════"
        
        # Step 1: 截图
        echo ""
        info "📸 截图..."
        local screenshot
        screenshot=$(capture_screenshot)
        if [ $? -ne 0 ] || [ -z "$screenshot" ]; then
            err "截图失败，等待重试..."
            sleep "$SCREENSHOT_INTERVAL"
            continue
        fi
        log "✅ 截图完成 (${#screenshot} bytes)"
        
        # Step 2: 发送到服务器进行完整分析
        echo ""
        info "🧠 发送到服务器分析..."
        local result
        result=$(send_to_server "$screenshot" "/v1/full-cycle")
        if [ $? -ne 0 ] || [ -z "$result" ]; then
            err "服务器分析失败，等待重试..."
            sleep "$SCREENSHOT_INTERVAL"
            continue
        fi
        
        # Step 3: 解析结果
        local scene
        scene=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('scene','unknown'))" 2>/dev/null)
        
        echo ""
        info "场景: $scene"
        
        # 如果不是战斗场景
        if [ "$scene" != "battle" ]; then
            case "$scene" in
                "menu")
                    warn "当前在菜单界面，请手动进入 PVP"
                    sleep 5
                    continue
                    ;;
                "matching")
                    warn "匹配中，等待..."
                    sleep 3
                    continue
                    ;;
                "result")
                    log "🏁 战斗结束！"
                    # 点击"继续"按钮
                    execute_tap 540 1600
                    sleep 3
                    continue
                    ;;
                *)
                    warn "未知场景 ($scene)，等待..."
                    sleep 2
                    continue
                    ;;
            esac
        fi
        
        # Step 4: 显示战局状态
        local my_name my_hp enemy_name enemy_hp weather
        my_name=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('battle_state',{}).get('my_pet',{}).get('name','?'))" 2>/dev/null)
        my_hp=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('battle_state',{}).get('my_pet',{}).get('hp','?'))" 2>/dev/null)
        enemy_name=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('battle_state',{}).get('enemy_pet',{}).get('name','?'))" 2>/dev/null)
        enemy_hp=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('battle_state',{}).get('enemy_pet',{}).get('hp','?'))" 2>/dev/null)
        weather=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('battle_state',{}).get('weather','无'))" 2>/dev/null)
        
        echo ""
        log "⚔️  $my_name (HP:$my_hp%) VS $enemy_name (HP:$enemy_hp%)"
        log "🌤  天气: $weather"
        
        # Step 5: 显示思考过程
        local thinking_json
        thinking_json=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('thinking',[])))" 2>/dev/null)
        
        echo ""
        info "🧠 AI 思考过程:"
        echo "$thinking_json" | python3 -c "
import sys,json
lines = json.load(sys.stdin)
for line in lines:
    print(f'  {line}')
" 2>/dev/null
        
        # Step 6: 获取决策
        local action target reason confidence x y
        action=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('decision',{}).get('action',''))" 2>/dev/null)
        target=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('decision',{}).get('target',''))" 2>/dev/null)
        reason=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('decision',{}).get('reason',''))" 2>/dev/null)
        confidence=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('decision',{}).get('confidence',0))" 2>/dev/null)
        coords=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('decision',{}).get('target_coords',[])))" 2>/dev/null)
        
        echo ""
        log "🎯 决策: ${action} → ${target}"
        log "💡 理由: ${reason}"
        log "📈 置信度: $(echo "$confidence * 100" | bc 2>/dev/null || echo "${confidence}")%"
        
        # Step 7: 倒计时
        echo ""
        for i in 3 2 1; do
            echo -ne "\r${YELLOW}⏱ 倒计时: ${i}... ${NC}"
            sleep 1
        done
        echo -e "\r${GREEN}⏱ 执行!${NC}  "
        
        # Step 8: 执行点击
        if [ -n "$coords" ] && [ "$coords" != "[]" ] && [ "$coords" != "null" ]; then
            x=$(echo "$coords" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0] if len(d)>0 else '')" 2>/dev/null)
            y=$(echo "$coords" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[1] if len(d)>1 else '')" 2>/dev/null)
            
            if [ -n "$x" ] && [ -n "$y" ]; then
                log "👆 点击: ($x, $y)"
                execute_tap "$x" "$y"
            fi
        else
            warn "没有坐标信息，跳过点击"
        fi
        
        # Step 9: 等待动画
        echo ""
        info "⏳ 等待动画播放..."
        sleep "$CLICK_DELAY"
        
        # Step 10: 短暂等待后继续
        sleep 2
    done
    
    log ""
    log "=========================================="
    log "战斗循环结束 (共 $round 回合)"
    log "=========================================="
}

# ============================================================================
# 入口
# ============================================================================

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    洛克王国 PVP AI 代打系统                  ║"
echo "║    Rock Kingdom PVP AI Agent                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

check_prereqs
main_loop