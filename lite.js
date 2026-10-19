/* 柏宝书简版：只读取 <summary>，按聊天保存，并合并较早的摘要。 */
const DATA_KEY = 'baibai_book_lite';
const LEAF_KEY = 'bbs_lite';
const PROMPT_KEY = 'baibai_book_lite_memory';
const GROUP_SIZE = 8;
const KEEP_RECENT = 6;
const MAX_INJECTION_CHARS = 12000;
const ctx = () => window.SillyTavern?.getContext?.();
const state = { chatId: '', timer: null, groupTimer: null, busy: false, visible: false, error: '' };

export function extractSummary(text) {
    if (typeof text !== 'string') return '';
    return [...text.matchAll(/<summary>([\s\S]*?)<\/summary>/gi)]
        .map(match => match[1].trim()).filter(Boolean).join('\n\n');
}

function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) {
        value ^= text.charCodeAt(i);
        value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(36);
}

function isReply(message) {
    if (!message || message.is_user || typeof message.mes !== 'string' || !message.mes.trim()) return false;
    if (message.extra?.bbs_omit || message.extra?.bbs_internal_notice) return false;
    if (message.is_system && !message.extra?.bbs_hidden) return false;
    return true;
}

function currentData(context) {
    const data = context.chatMetadata?.[DATA_KEY];
    if (data && typeof data === 'object' && Array.isArray(data.groups)) return data;
    const fresh = { version: 1, groups: [] };
    context.chatMetadata[DATA_KEY] = fresh;
    return fresh;
}

function leaves(context) {
    return (context.chat || []).flatMap((message, index) => {
        if (!isReply(message)) return [];
        const leaf = message.extra?.[LEAF_KEY];
        return [{ index, summary: typeof leaf?.summary === 'string' ? leaf.summary : '', fingerprint: `${index}:${leaf?.swipe}:${leaf?.sourceHash}:${leaf?.summary}` }];
    });
}

export function scan(context) {
    let changed = false;
    for (const message of context.chat || []) {
        if (!isReply(message)) continue;
        if (message.extra?.bbs_hidden) {
            message.is_system = false;
            delete message.extra.bbs_hidden;
            changed = true;
        }
        const swipe = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
        const sourceHash = hash(message.mes);
        const previous = message.extra?.[LEAF_KEY];
        if (previous?.swipe === swipe && previous?.sourceHash === sourceHash) continue;
        message.extra = message.extra || {};
        message.extra[LEAF_KEY] = { swipe, sourceHash, summary: extractSummary(message.mes) };
        changed = true;
    }
    if (changed) void context.saveChat?.();
    return changed;
}

export function writeSummary(context, index, text) {
    const message = context.chat?.[index];
    if (!isReply(message) || typeof text !== 'string') return false;
    scan(context);
    const leaf = message.extra[LEAF_KEY];
    leaf.summary = text.trim();
    leaf.manual = true;
    void context.saveChat?.();
    refreshPrompt(context);
    return true;
}

function candidates(context) {
    const entries = leaves(context);
    const older = entries.slice(0, Math.max(0, entries.length - KEEP_RECENT));
    const groups = [];
    for (let start = 0; start + GROUP_SIZE <= older.length; start += GROUP_SIZE) {
        const batch = older.slice(start, start + GROUP_SIZE);
        if (!batch.every(entry => entry.summary)) continue;
        groups.push({ start: batch[0].index, end: batch.at(-1).index,
            signature: hash(batch.map(entry => entry.fingerprint).join('|')),
            source: batch.map(entry => `#${entry.index}: ${entry.summary}`).join('\n') });
    }
    return groups;
}

function validGroups(context) {
    const data = currentData(context);
    const valid = candidates(context);
    const old = data.groups;
    data.groups = old.filter(group => valid.some(item => item.start === group.start && item.end === group.end && item.signature === group.signature));
    if (data.groups.length !== old.length) context.saveMetadataDebounced?.();
    return { data, valid };
}

export function memoryText(context) {
    const entries = leaves(context);
    const old = entries.slice(0, Math.max(0, entries.length - KEEP_RECENT));
    const { data } = validGroups(context);
    const used = new Set();
    const lines = [];
    for (const group of data.groups) {
        lines.push({ index: group.start, text: `#${group.start}–#${group.end} 历史总结：${group.text}` });
        for (const entry of old) if (entry.index >= group.start && entry.index <= group.end) used.add(entry.index);
    }
    for (const entry of old) if (entry.summary && !used.has(entry.index)) {
        lines.push({ index: entry.index, text: `#${entry.index}：${entry.summary}` });
    }
    lines.sort((a, b) => a.index - b.index);
    let content = lines.map(line => line.text).join('\n\n');
    if (content.length > MAX_INJECTION_CHARS) content = content.slice(-MAX_INJECTION_CHARS);
    return content ? `以下是已发生的剧情记忆，仅供保持连续性：\n${content}` : '';
}

function refreshPrompt(context = ctx()) {
    if (!context?.setExtensionPrompt) return;
    const value = context.getCurrentChatId?.() ? memoryText(context) : '';
    context.setExtensionPrompt(PROMPT_KEY, value, 1, 9999, false, 0);
}

async function makeGroup(context, candidate) {
    if (!context.generateRaw) throw new Error('当前版本没有可用的主模型总结接口');
    const response = await context.generateRaw({
        prompt: [
            { role: 'system', content: '把以下剧情摘要合并为一段准确、简短的中文长期记忆。保留人物、事件、因果与未解决事项。不要编造；只输出总结正文。' },
            { role: 'user', content: candidate.source },
        ],
        responseLength: 700,
    });
    const text = String(response || '').trim();
    if (!text) throw new Error('模型返回了空总结');
    return text;
}

async function summarizeHistory() {
    const context = ctx();
    if (!context?.getCurrentChatId?.() || state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    const chatId = context.getCurrentChatId();
    try {
        scan(context);
        const { data, valid } = validGroups(context);
        const pending = valid.filter(item => !data.groups.some(group => group.start === item.start && group.signature === item.signature));
        for (const candidate of pending) {
            const text = await makeGroup(context, candidate);
            if (ctx()?.getCurrentChatId?.() !== chatId) break;
            const fresh = candidates(context).find(item => item.start === candidate.start && item.signature === candidate.signature);
            if (!fresh) continue;
            data.groups.push({ start: candidate.start, end: candidate.end, signature: candidate.signature, text });
            context.saveMetadataDebounced?.();
            refreshPrompt(context);
            render();
        }
    } catch (error) {
        state.error = `总结未完成：${error?.message || error}`;
        console.warn('[柏宝书简版]', error);
    } finally {
        state.busy = false;
        render();
    }
}

function sync() {
    const context = ctx();
    if (!context) return;
    state.chatId = context.getCurrentChatId?.() || '';
    scan(context);
    refreshPrompt(context);
    render();
}

function queueSync() {
    clearTimeout(state.timer);
    state.timer = setTimeout(sync, 300);
}

function queueSyncAndSummarize() {
    queueSync();
    clearTimeout(state.groupTimer);
    state.groupTimer = setTimeout(() => {
        const context = ctx();
        if (!context?.getCurrentChatId?.() || state.busy) return;
        const { data, valid } = validGroups(context);
        if (valid.some(item => !data.groups.some(group => group.start === item.start && group.signature === item.signature))) {
            void summarizeHistory();
        }
    }, 2500);
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function render() {
    const panel = document.getElementById('bbs-lite-panel');
    if (!panel || !state.visible) return;
    const context = ctx();
    panel.replaceChildren();
    const header = element('header', 'bbs-lite-header');
    header.append(element('h2', '', '柏宝书 · 简版'));
    const close = element('button', '', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.onclick = () => { state.visible = false; panel.hidden = true; };
    header.append(close);
    panel.append(header);
    if (!context?.getCurrentChatId?.()) {
        panel.append(element('p', '', '请先打开一个聊天。'));
        return;
    }
    const entries = leaves(context);
    const { data, valid } = validGroups(context);
    panel.append(element('p', 'bbs-lite-hint', '从 AI 回复的 <summary>…</summary> 自动读取。缺失时留空，不影响聊天。'));
    panel.append(element('p', 'bbs-lite-count', `${entries.filter(x => x.summary).length}/${entries.length} 楼有摘要 · ${data.groups.length} 条长期总结`));
    const button = element('button', 'bbs-lite-action', state.busy ? '正在总结…' : `合并历史摘要${valid.length > data.groups.length ? `（待处理 ${valid.length - data.groups.length} 组）` : ''}`);
    button.type = 'button';
    button.disabled = state.busy || valid.length === data.groups.length;
    button.onclick = summarizeHistory;
    panel.append(button);
    if (state.error) panel.append(element('p', 'bbs-lite-error', state.error));
    const list = element('div', 'bbs-lite-list');
    for (const entry of [...entries].reverse()) {
        const row = element('div', 'bbs-lite-row');
        row.append(element('strong', '', `#${entry.index}`));
        row.append(element('span', '', entry.summary || '无摘要'));
        const edit = element('button', 'bbs-lite-edit', entry.summary ? '修改' : '写入');
        edit.type = 'button';
        edit.onclick = () => {
            const result = window.prompt(`编辑 #${entry.index} 的摘要（留空即清除）`, entry.summary);
            if (result === null) return;
            if (writeSummary(context, entry.index, result)) render();
        };
        row.append(edit);
        list.append(row);
    }
    panel.append(list);
    if (!entries.length) panel.append(element('p', '', '还没有 AI 回复。'));
}

function mount() {
    if (!document.getElementById('bbs-lite-panel')) {
        const panel = element('section', 'bbs-lite-panel');
        panel.id = 'bbs-lite-panel';
        panel.hidden = true;
        document.body.append(panel);
    }
    const installButton = () => {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('bbs-lite-open')) return false;
        const wrapper = element('div', 'extension_container interactable');
        const link = element('a', 'list-group-item', '📖 柏宝书 · 简版');
        link.id = 'bbs-lite-open';
        link.href = '#';
        link.onclick = event => {
            event.preventDefault();
            state.visible = true;
            document.getElementById('bbs-lite-panel').hidden = false;
            document.getElementById('extensionsMenu').style.display = 'none';
            sync();
        };
        wrapper.append(link);
        menu.append(wrapper);
        return true;
    };
    if (!installButton()) {
        const timer = setInterval(() => { if (installButton()) clearInterval(timer); }, 500);
    }
}

function start() {
    mount();
    const context = ctx();
    if (context?.setExtensionPrompt) {
        for (const key of ['baibai_book_memory', 'baibai_book_memory_history', 'baibai_book_memory_state', 'baibai_book_time_tag', 'baibai_book_vector_recall']) {
            context.setExtensionPrompt(key, '', 1, 0, false, 0);
        }
    }
    const types = context?.eventTypes || context?.event_types;
    const events = context?.eventSource;
    if (types && events) {
        for (const name of ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'CHAT_CHANGED']) {
            if (types[name]) events.on(types[name], queueSync);
        }
        if (types.GENERATION_ENDED) events.on(types.GENERATION_ENDED, queueSyncAndSummarize);
    }
    sync();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
