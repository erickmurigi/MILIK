import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCheckCircle,
  FaChevronDown,
  FaChevronRight,
  FaEnvelope,
  FaHistory,
  FaLock,
  FaPaperPlane,
  FaSms,
  FaSyncAlt,
  FaTimes,
  FaTimesCircle,
  FaVial,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  getCommunicationTemplates,
  getSmsLogs,
  previewCommunicationMessage,
  sendCommunicationMessage,
  sendTestSms,
} from '../../redux/apiCalls';

// ─── helpers ────────────────────────────────────────────────────────────────

const channelMeta = {
  sms: { label: 'SMS', Icon: FaSms, accent: 'emerald' },
  email: { label: 'Email', Icon: FaEnvelope, accent: 'orange' },
};

const countSmsInfo = (text = '') => {
  if (!text) return { chars: 0, segments: 0, remaining: 160, encoding: 'GSM-7' };
  const isUnicode = /[^\x00-\x7F]/.test(text);
  const maxSingle = isUnicode ? 70 : 160;
  const maxMulti = isUnicode ? 67 : 153;
  const len = text.length;
  const segments = len <= maxSingle ? 1 : Math.ceil(len / maxMulti);
  const remaining = segments === 1 ? maxSingle - len : segments * maxMulti - len;
  return { chars: len, segments, remaining, encoding: isUnicode ? 'Unicode' : 'GSM-7' };
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const truncate = (text = '', max = 80) =>
  String(text || '').length > max ? String(text).slice(0, max) + '…' : String(text || '');

const statusTone = (status) => {
  if (status === 'sent') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

const contextLabel = (ctx = '') =>
  String(ctx || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—';

// ─── empty state ─────────────────────────────────────────────────────────────

const emptyChannels = {
  sms: { templates: [], profileStatus: null },
  email: { templates: [], profileStatus: null },
};

// ─── component ────────────────────────────────────────────────────────────────

const CommunicationComposerModal = ({
  open,
  onClose,
  businessId,
  contextType,
  recordIds = [],
  title = 'Send Communication',
  subtitle = '',
  allowedChannels = ['sms', 'email'],
  defaultChannel = 'sms',
  onSent,
}) => {
  const normalizedIds = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(recordIds) ? recordIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
        )
      ),
    [recordIds]
  );

  // ── tab: 'compose' | 'history'
  const [activeTab, setActiveTab] = useState('compose');

  // ── compose state
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [channels, setChannels] = useState(emptyChannels);
  const [activeChannel, setActiveChannel] = useState(defaultChannel);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [expandedPreviewId, setExpandedPreviewId] = useState(null);

  // ── test SMS state
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);

  // ── history state
  const [historyLogs, setHistoryLogs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all');

  const prevPreviewKey = useRef('');

  // ── reset on open
  useEffect(() => {
    if (!open) return;
    setActiveTab('compose');
    setActiveChannel(defaultChannel);
    setSelectedTemplateKey('');
    setCustomBody('');
    setPreview(null);
    setExpandedPreviewId(null);
    setShowTestPanel(false);
  }, [open, defaultChannel]);

  // ── load templates
  useEffect(() => {
    if (!open || !businessId || !contextType) return;
    let mounted = true;
    (async () => {
      try {
        setLoadingTemplates(true);
        const res = await getCommunicationTemplates({ business: businessId, contextType });
        if (!mounted) return;
        setChannels(res?.channels || emptyChannels);
        const preferred = allowedChannels.includes(defaultChannel) ? defaultChannel : allowedChannels[0] || defaultChannel;
        setActiveChannel(preferred);
      } catch (err) {
        if (mounted) toast.error(err?.response?.data?.message || err?.message || 'Failed to load templates.');
      } finally {
        if (mounted) setLoadingTemplates(false);
      }
    })();
    return () => { mounted = false; };
  }, [open, businessId, contextType, allowedChannels, defaultChannel]);

  // ── auto-select first template & populate body
  const templatesForChannel = useMemo(() => channels?.[activeChannel]?.templates || [], [channels, activeChannel]);
  const profileStatus = channels?.[activeChannel]?.profileStatus || null;

  useEffect(() => {
    if (!templatesForChannel.length) {
      setSelectedTemplateKey('');
      setCustomBody('');
      setPreview(null);
      return;
    }
    const exists = templatesForChannel.some((t) => t.key === selectedTemplateKey);
    if (!exists) {
      setSelectedTemplateKey(templatesForChannel[0].key);
    }
  }, [templatesForChannel, selectedTemplateKey]);

  // ── populate body when template changes
  useEffect(() => {
    const tpl = templatesForChannel.find((t) => t.key === selectedTemplateKey);
    if (tpl) {
      setCustomBody(tpl.messageBody || tpl.body || '');
    }
  }, [selectedTemplateKey]);

  const smsInfo = useMemo(() => countSmsInfo(customBody), [customBody]);

  // ── auto-preview when template/channel changes
  useEffect(() => {
    if (!open || !selectedTemplateKey) return;
    const key = `${activeChannel}::${selectedTemplateKey}::${normalizedIds.join(',')}`;
    if (prevPreviewKey.current === key) return;
    prevPreviewKey.current = key;
    handlePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedTemplateKey, activeChannel]);

  const handlePreview = async () => {
    if (!businessId || !contextType || !activeChannel || !selectedTemplateKey) {
      toast.warning('Choose a template first.');
      return;
    }
    if (!normalizedIds.length) {
      toast.warning('Select at least one record before previewing.');
      return;
    }
    try {
      setPreviewLoading(true);
      const res = await previewCommunicationMessage({
        business: businessId,
        contextType,
        channel: activeChannel,
        templateKey: selectedTemplateKey,
        recordIds: normalizedIds,
        customBody: customBody || undefined,
      });
      setPreview(res);
    } catch (err) {
      setPreview(null);
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selectedTemplateKey) { toast.warning('Choose a template first.'); return; }
    try {
      setSending(true);
      const res = await sendCommunicationMessage({
        business: businessId,
        contextType,
        channel: activeChannel,
        templateKey: selectedTemplateKey,
        recordIds: normalizedIds,
        customBody: customBody || undefined,
      });
      setPreview(res);
      const sent = Number(res?.summary?.sentCount || 0);
      const failed = Number(res?.summary?.failedCount || 0);
      if (sent > 0 && failed === 0) toast.success(`${sent} ${channelMeta[activeChannel]?.label || 'message'}${sent !== 1 ? 's' : ''} sent.`);
      else if (sent > 0) toast.warn(`${sent} sent, ${failed} failed.`);
      else toast.error('No messages were sent.');
      if (typeof onSent === 'function') onSent(res);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  const handleTestSms = async () => {
    if (!testPhone.trim()) { toast.warning('Enter a phone number for the test SMS.'); return; }
    setTestSending(true);
    try {
      const res = await sendTestSms({
        business: businessId,
        phone: testPhone.trim(),
        message: testMessage.trim() || undefined,
      });
      toast.success(`Test SMS sent to ${res.to}${res.messageId ? ` (ID: ${res.messageId})` : ''}.`);
      setTestPhone('');
      setTestMessage('');
      setShowTestPanel(false);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Test SMS failed.');
    } finally {
      setTestSending(false);
    }
  };

  // ── history
  const loadHistory = async () => {
    if (!businessId) return;
    setHistoryLoading(true);
    try {
      const logs = await getSmsLogs(businessId, {
        limit: 50,
        channel: historyFilter !== 'all' ? historyFilter : undefined,
      });
      setHistoryLogs(Array.isArray(logs) ? logs : []);
    } catch {
      setHistoryLogs([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (open && activeTab === 'history') loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, historyFilter]);

  if (!open) return null;

  const sendableCount = Number(preview?.summary?.sendableCount || 0);
  const blockedCount = Number(preview?.summary?.blockedCount || 0);
  const sentCount = preview?.summary?.sentCount;
  const failedCount = preview?.summary?.failedCount;
  const hasSendResults = sentCount !== undefined;
  const selectedTemplate = templatesForChannel.find((t) => t.key === selectedTemplateKey);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">

        {/* ── header ── */}
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-[#0B3B2E] to-emerald-800 px-6 py-4 text-white">
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-bold truncate">{title}</h3>
            <p className="mt-0.5 text-[11px] text-emerald-200">{subtitle || 'Compose, preview, and send in one step.'}</p>
          </div>

          {/* tab pills */}
          <div className="mx-4 flex items-center gap-1 rounded-full bg-white/10 p-1">
            {['compose', 'history'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                  activeTab === tab ? 'bg-white text-[#0B3B2E]' : 'text-white/70 hover:text-white'
                }`}
              >
                {tab === 'history' ? <FaHistory className="inline mr-1 text-[10px]" /> : null}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            disabled={sending}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            <FaTimes className="text-[13px]" />
          </button>
        </div>

        {/* ══ COMPOSE TAB ══ */}
        {activeTab === 'compose' && (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[340px_1fr]">

            {/* ── left panel ── */}
            <div className="flex flex-col gap-4 overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 lg:border-b-0 lg:border-r">

              {/* recipients */}
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Recipients Selected</p>
                <p className="mt-1 text-3xl font-black text-slate-900">{normalizedIds.length}</p>
              </div>

              {/* channel */}
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Channel</p>
                <div className="grid grid-cols-2 gap-2">
                  {allowedChannels.filter((c) => ['sms', 'email'].includes(c)).map((ch) => {
                    const meta = channelMeta[ch];
                    const Icon = meta?.Icon || FaPaperPlane;
                    const hasTemplates = (channels?.[ch]?.templates || []).length > 0;
                    const active = activeChannel === ch;
                    return (
                      <button
                        key={ch}
                        onClick={() => { setActiveChannel(ch); setPreview(null); prevPreviewKey.current = ''; }}
                        disabled={!hasTemplates}
                        className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-[12px] font-semibold transition ${
                          active
                            ? 'border-[#0B3B2E] bg-[#0B3B2E] text-white shadow-sm'
                            : hasTemplates
                            ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                            : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        }`}
                      >
                        <Icon className="text-[12px]" /> {meta?.label || ch}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* template */}
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Template</p>
                <select
                  value={selectedTemplateKey}
                  onChange={(e) => { setSelectedTemplateKey(e.target.value); setPreview(null); prevPreviewKey.current = ''; }}
                  disabled={loadingTemplates || !templatesForChannel.length}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-[12px] text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                >
                  {!templatesForChannel.length && <option value="">No templates available</option>}
                  {templatesForChannel.map((t) => (
                    <option key={t.key} value={t.key}>{t.name}</option>
                  ))}
                </select>
                {selectedTemplate?.description && (
                  <p className="mt-1.5 text-[11px] text-slate-500">{selectedTemplate.description}</p>
                )}
              </div>

              {/* message body editor */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Message Body</p>
                  {activeChannel === 'sms' && customBody && (
                    <span className={`text-[10px] font-semibold ${smsInfo.segments > 1 ? 'text-orange-600' : 'text-slate-400'}`}>
                      {smsInfo.chars} ch · {smsInfo.segments} SMS
                    </span>
                  )}
                </div>
                <textarea
                  rows={activeChannel === 'sms' ? 5 : 4}
                  value={customBody}
                  onChange={(e) => setCustomBody(e.target.value)}
                  placeholder={activeChannel === 'sms' ? 'Type your SMS message… Placeholders like {tenantName} will be resolved per recipient.' : 'Type your email body…'}
                  className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-[12px] text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
                {activeChannel === 'sms' && customBody && (
                  <div className="mt-1 flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-400">{smsInfo.encoding}</span>
                    <span className="text-[10px] text-slate-400">{smsInfo.remaining} chars remaining in segment {smsInfo.segments}</span>
                  </div>
                )}
              </div>

              {/* sender profile */}
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[12px]">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Sender Profile</p>
                {profileStatus ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        profileStatus.code === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                        profileStatus.code === 'configured' ? 'border-blue-200 bg-blue-50 text-blue-700' :
                        'border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        {profileStatus.label || 'Profile'}
                      </span>
                    </div>
                    {profileStatus.reason && <p className="text-[11px] text-slate-500">{profileStatus.reason}</p>}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">No default {activeChannel === 'sms' ? 'SMS' : 'email'} profile configured yet.</p>
                )}
              </div>

              {/* test SMS panel (SMS only) */}
              {activeChannel === 'sms' && (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <button
                    onClick={() => setShowTestPanel((prev) => !prev)}
                    className="flex w-full items-center justify-between text-[11px] font-bold text-slate-600"
                  >
                    <span className="flex items-center gap-1.5"><FaVial className="text-[10px]" /> Send Test SMS</span>
                    {showTestPanel ? <FaChevronDown className="text-[10px]" /> : <FaChevronRight className="text-[10px]" />}
                  </button>
                  {showTestPanel && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="tel"
                        placeholder="+254712345678"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-[12px] outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                      />
                      <textarea
                        rows={2}
                        placeholder="Custom test message (optional)"
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-[12px] outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-100"
                      />
                      <button
                        onClick={handleTestSms}
                        disabled={testSending || !testPhone.trim()}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF8C00] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#e67e00] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FaVial className="text-[10px]" />
                        {testSending ? 'Sending test…' : 'Send Test SMS'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* action buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handlePreview}
                  disabled={previewLoading || loadingTemplates || !selectedTemplateKey}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSyncAlt className={`text-[11px] ${previewLoading ? 'animate-spin' : ''}`} />
                  Refresh Preview
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending || previewLoading || !preview || sendableCount === 0}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#0B3B2E] px-3 py-2.5 text-[12px] font-semibold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  <FaPaperPlane className="text-[11px]" />
                  {sending ? 'Sending…' : 'Send Now'}
                </button>
              </div>
            </div>

            {/* ── right panel: preview ── */}
            <div className="flex min-h-0 flex-col overflow-hidden">
              {/* stats bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-5 py-3">
                <Pill label="Sendable" value={sendableCount} tone="emerald" />
                <Pill label="Blocked" value={blockedCount} tone="red" />
                {hasSendResults && (
                  <>
                    <Pill label="Sent" value={sentCount} tone="blue" />
                    <Pill label="Failed" value={failedCount} tone="orange" />
                  </>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
                {!preview && !previewLoading && (
                  <EmptyState text="Select a template and click Refresh Preview to see the resolved messages." />
                )}
                {previewLoading && (
                  <EmptyState text="Preparing preview…" />
                )}
                {!previewLoading && (preview?.previews || []).map((item) => {
                  const result = hasSendResults
                    ? (preview?.results || []).find((r) => r.recordId === item.recordId)
                    : null;
                  const expanded = expandedPreviewId === item.recordId;
                  return (
                    <PreviewCard
                      key={item.recordId}
                      item={item}
                      result={result}
                      channel={activeChannel}
                      expanded={expanded}
                      onToggle={() => setExpandedPreviewId((prev) => (prev === item.recordId ? null : item.recordId))}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ══ HISTORY TAB ══ */}
        {activeTab === 'history' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Filter:</p>
              {['all', 'sms', 'email'].map((f) => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    historyFilter === f
                      ? 'border-[#0B3B2E] bg-[#0B3B2E] text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
              <button
                onClick={loadHistory}
                disabled={historyLoading}
                className="ml-auto flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
              >
                <FaSyncAlt className={`text-[10px] ${historyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {historyLoading && (
                <div className="flex items-center justify-center py-16 text-[12px] text-slate-400">Loading history…</div>
              )}
              {!historyLoading && historyLogs.length === 0 && (
                <div className="flex items-center justify-center py-16 text-[12px] text-slate-400">
                  No sent messages found. Messages appear here after sending.
                </div>
              )}
              {!historyLoading && historyLogs.length > 0 && (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {['Time', 'Ch.', 'Recipient', 'Template', 'Status', 'Msg ID / Cost', 'Message'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historyLogs.map((log) => (
                      <tr key={log._id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDateTime(log.sentAt || log.createdAt)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            log.channel === 'sms' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-orange-200 bg-orange-50 text-orange-700'
                          }`}>{String(log.channel || '').toUpperCase()}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-800">{log.recipientName || '—'}</div>
                          <div className="text-[10px] text-slate-400">{log.to || '—'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-slate-700">{log.templateName || contextLabel(log.contextType)}</div>
                          {log.isTest && <span className="text-[10px] font-bold text-violet-600">TEST</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone(log.status)}`}>
                            {String(log.status || 'pending').toUpperCase()}
                          </span>
                          {log.error && <div className="mt-0.5 text-[10px] text-red-500 max-w-[120px] truncate" title={log.error}>{log.error}</div>}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {log.providerMessageId && <div className="font-mono text-[10px]">{truncate(log.providerMessageId, 20)}</div>}
                          {log.costLabel && <div className="text-[10px] text-slate-400">{log.costLabel}</div>}
                        </td>
                        <td className="max-w-[200px] px-3 py-2 text-slate-600">{truncate(log.body, 70)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── sub-components ──────────────────────────────────────────────────────────

const Pill = ({ label, value, tone }) => {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    red: 'border-red-200 bg-red-50 text-red-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    orange: 'border-orange-200 bg-orange-50 text-orange-800',
  };
  return (
    <div className={`rounded-2xl border px-3 py-1.5 text-[11px] font-semibold ${tones[tone] || tones.emerald}`}>
      {label}: <span className="font-black">{value}</span>
    </div>
  );
};

const EmptyState = ({ text }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-[12px] text-slate-400">
    {text}
  </div>
);

const PreviewCard = ({ item, result, channel, expanded, onToggle }) => {
  const hasSent = result?.status === 'sent';
  const hasFailed = result?.status === 'failed';
  const statusIcon = hasSent ? (
    <FaCheckCircle className="text-emerald-500" />
  ) : hasFailed ? (
    <FaTimesCircle className="text-red-500" />
  ) : !item.canSend ? (
    <FaLock className="text-slate-400" />
  ) : null;

  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${hasFailed ? 'border-red-200' : hasSent ? 'border-emerald-200' : 'border-slate-200'}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon}
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-slate-900 truncate">{item.recipientName || 'Recipient'}</p>
            <p className="text-[11px] text-slate-400 truncate">
              {channel === 'sms' ? item.recipientPhone : item.recipientEmail || 'No address'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result ? (
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${hasSent ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {hasSent ? 'Sent' : 'Failed'}
            </span>
          ) : (
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${item.canSend ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {item.canSend ? 'Ready' : 'Blocked'}
            </span>
          )}
          <FaChevronDown className={`text-[10px] text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
          {item.subject && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
              <span className="font-semibold text-slate-900">Subject: </span>{item.subject}
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] whitespace-pre-wrap text-slate-800">
            {item.body || 'No message body.'}
          </div>
          {item.missingPlaceholders?.length > 0 && (
            <p className="text-[11px] text-red-600">Missing values: {item.missingPlaceholders.join(', ')}</p>
          )}
          {item.reason && !item.canSend && (
            <p className="text-[11px] text-red-600">{item.reason}</p>
          )}
          {result?.messageId && (
            <p className="text-[11px] text-slate-500 font-mono">Provider ID: {result.messageId}</p>
          )}
          {result?.cost && (
            <p className="text-[11px] text-slate-500">Cost: {result.cost}</p>
          )}
          {result?.message && hasFailed && (
            <p className="text-[11px] text-red-600">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default CommunicationComposerModal;
