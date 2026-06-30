import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaCheckCircle,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaEnvelope,
  FaExclamationTriangle,
  FaHistory,
  FaLock,
  FaPaperPlane,
  FaPhone,
  FaRegEnvelope,
  FaSms,
  FaSyncAlt,
  FaTimes,
  FaTimesCircle,
  FaUsers,
  FaVial,
} from 'react-icons/fa';
import { MdOutlineMessage } from 'react-icons/md';
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
  sms:   { label: 'SMS',   Icon: FaSms,        accent: 'teal',   color: 'text-teal-600',   bg: 'bg-teal-600',   pill: 'bg-teal-50 border-teal-200 text-teal-700' },
  email: { label: 'Email', Icon: FaRegEnvelope, accent: 'indigo', color: 'text-indigo-600', bg: 'bg-indigo-600', pill: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
};

const countSmsInfo = (text = '') => {
  if (!text) return { chars: 0, segments: 0, remaining: 160, encoding: 'GSM-7' };
  const isUnicode = /[^\x00-\x7F]/.test(text);
  const maxSingle = isUnicode ? 70 : 160;
  const maxMulti  = isUnicode ? 67 : 153;
  const len = text.length;
  const segments = len <= maxSingle ? 1 : Math.ceil(len / maxMulti);
  const remaining = segments === 1 ? maxSingle - len : segments * maxMulti - len;
  return { chars: len, segments, remaining, encoding: isUnicode ? 'Unicode' : 'GSM-7' };
};

const smsSegmentProgress = (info) => {
  const maxPerSeg = info.segments === 1
    ? (info.encoding === 'Unicode' ? 70 : 160)
    : (info.encoding === 'Unicode' ? 67 : 153);
  return Math.min(100, Math.round(((maxPerSeg - info.remaining) / maxPerSeg) * 100));
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const truncate = (text = '', max = 80) =>
  String(text || '').length > max ? String(text).slice(0, max) + '…' : String(text || '');

const contextLabel = (ctx = '') =>
  String(ctx || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—';

const emptyChannels = {
  sms:   { templates: [], profileStatus: null },
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

  const [activeTab,           setActiveTab]           = useState('compose');
  const [loadingTemplates,    setLoadingTemplates]    = useState(false);
  const [previewLoading,      setPreviewLoading]      = useState(false);
  const [sending,             setSending]             = useState(false);
  const [channels,            setChannels]            = useState(emptyChannels);
  const [activeChannel,       setActiveChannel]       = useState(defaultChannel);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [customBody,          setCustomBody]          = useState('');
  const [preview,             setPreview]             = useState(null);
  const [expandedPreviewId,   setExpandedPreviewId]   = useState(null);
  const [sampleIndex,         setSampleIndex]         = useState(0);

  const [testPhone,     setTestPhone]     = useState('');
  const [testMessage,   setTestMessage]   = useState('');
  const [testSending,   setTestSending]   = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);

  const [historyLogs,    setHistoryLogs]    = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter,  setHistoryFilter]  = useState('all');

  const prevPreviewKey = useRef('');

  useEffect(() => {
    if (!open) return;
    setActiveTab('compose');
    setActiveChannel(defaultChannel);
    setSelectedTemplateKey('');
    setCustomBody('');
    setPreview(null);
    setExpandedPreviewId(null);
    setSampleIndex(0);
    setShowTestPanel(false);
  }, [open, defaultChannel]);

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
    if (!exists) setSelectedTemplateKey(templatesForChannel[0].key);
  }, [templatesForChannel, selectedTemplateKey]);

  useEffect(() => {
    const tpl = templatesForChannel.find((t) => t.key === selectedTemplateKey);
    if (tpl) setCustomBody(tpl.messageBody || tpl.body || '');
  }, [selectedTemplateKey]);

  const smsInfo = useMemo(() => countSmsInfo(customBody), [customBody]);

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
      // 202 = queued for background delivery (bulk sends > 10 recipients)
      if (res?.queued) {
        toast.success(`${res.message || `Sending to ${res.count} recipients in the background.`} Check the communication log for delivery status.`);
        if (typeof onSent === 'function') onSent(res);
        return;
      }
      setPreview(res);
      const sent   = Number(res?.summary?.sentCount   || 0);
      const failed = Number(res?.summary?.failedCount || 0);
      if (sent > 0 && failed === 0) toast.success(`${sent} ${channelMeta[activeChannel]?.label || 'message'}${sent !== 1 ? 's' : ''} sent.`);
      else if (sent > 0) toast.warn(`${sent} sent, ${failed} failed.`);
      else {
        const firstError = Array.isArray(res?.results)
          ? res.results.find((r) => r.status === 'failed')?.message
          : null;
        toast.error(firstError ? `Send failed: ${firstError}` : 'No messages were sent.');
      }
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
        phone:    testPhone.trim(),
        message:  testMessage.trim() || undefined,
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

  const loadHistory = async () => {
    if (!businessId) return;
    setHistoryLoading(true);
    try {
      const logs = await getSmsLogs(businessId, {
        limit:   50,
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

  const sendableCount  = Number(preview?.summary?.sendableCount  || 0);
  const blockedCount   = Number(preview?.summary?.blockedCount   || 0);
  const sentCount      = preview?.summary?.sentCount;
  const failedCount    = preview?.summary?.failedCount;
  const hasSendResults = sentCount !== undefined;
  const previews       = preview?.previews || [];
  const chMeta         = channelMeta[activeChannel] || channelMeta.sms;
  const ChIcon         = chMeta.Icon;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
      <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">

        {/* ── HEADER ── */}
        <div className="relative flex items-center gap-4 border-b border-[#0B3B2E]/20 bg-gradient-to-r from-[#0B3B2E] via-[#0e4a39] to-[#155e4a] px-6 py-4">
          {/* icon + title */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white">
            <ChIcon className="text-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-white truncate">{title}</h3>
            <p className="text-[11px] text-emerald-300 mt-0.5">
              {subtitle || `Compose, preview, and send to ${normalizedIds.length} recipient${normalizedIds.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* recipients badge */}
          <div className="hidden sm:flex flex-col items-center rounded-xl bg-white/10 px-4 py-2 text-center">
            <span className="text-2xl font-black text-white leading-none">{normalizedIds.length}</span>
            <span className="text-[10px] text-emerald-300 font-semibold mt-0.5">Recipients</span>
          </div>

          {/* tab pills */}
          <div className="flex items-center gap-1 rounded-xl bg-white/10 p-1">
            {['compose', 'history'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                  activeTab === tab ? 'bg-white text-[#0B3B2E]' : 'text-white/70 hover:text-white'
                }`}
              >
                {tab === 'history' && <FaHistory className="text-[10px]" />}
                {tab === 'compose' && <MdOutlineMessage className="text-[11px]" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            disabled={sending}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 disabled:opacity-50"
          >
            <FaTimes className="text-[13px]" />
          </button>
        </div>

        {/* ══ COMPOSE TAB ══ */}
        {activeTab === 'compose' && (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[320px_1fr]">

            {/* ── LEFT PANEL ── */}
            <div className="flex flex-col overflow-y-auto border-r border-slate-200 bg-[#fafbfc]">

              {/* channel selector */}
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Channel</p>
                <div className="flex gap-2">
                  {allowedChannels.filter((c) => ['sms', 'email'].includes(c)).map((ch) => {
                    const meta = channelMeta[ch];
                    const Icon = meta?.Icon;
                    const hasTemplates = (channels?.[ch]?.templates || []).length > 0;
                    const active = activeChannel === ch;
                    return (
                      <button
                        key={ch}
                        onClick={() => { setActiveChannel(ch); setPreview(null); prevPreviewKey.current = ''; }}
                        disabled={!hasTemplates}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-bold transition ${
                          active
                            ? 'border-[#0B3B2E] bg-[#0B3B2E] text-white shadow-sm'
                            : hasTemplates
                            ? 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                            : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                        }`}
                      >
                        <Icon className="text-[13px]" />
                        {meta?.label || ch}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* template list */}
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Template</p>
                  {templatesForChannel.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {templatesForChannel.length}
                    </span>
                  )}
                </div>

                {loadingTemplates && (
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 py-6 text-[11px] text-slate-400">
                    <FaSyncAlt className="mr-2 animate-spin text-[10px]" /> Loading templates…
                  </div>
                )}
                {!loadingTemplates && !templatesForChannel.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
                    No templates available for this context.
                  </div>
                )}
                {!loadingTemplates && templatesForChannel.length > 0 && (
                  <div className="max-h-[190px] space-y-1.5 overflow-y-auto">
                    {templatesForChannel.map((t) => {
                      const isSelected = selectedTemplateKey === t.key;
                      return (
                        <button
                          key={t.key}
                          onClick={() => { setSelectedTemplateKey(t.key); setPreview(null); prevPreviewKey.current = ''; }}
                          className={`group w-full rounded-xl border px-3 py-2.5 text-left transition ${
                            isSelected
                              ? 'border-[#0B3B2E]/30 bg-[#0B3B2E]/5 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-[#0B3B2E] text-white' : 'bg-slate-100 text-slate-500'}`}>
                              <ChIcon className="text-[10px]" />
                            </div>
                            <span className={`min-w-0 flex-1 truncate text-[11px] font-bold ${isSelected ? 'text-[#0B3B2E]' : 'text-slate-800'}`}>
                              {t.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              {t.sendMode && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${isSelected ? 'bg-[#0B3B2E]/10 text-[#0B3B2E]' : 'bg-slate-100 text-slate-400'}`}>
                                  {t.sendMode}
                                </span>
                              )}
                              {isSelected && <FaCheckCircle className="text-[10px] text-[#0B3B2E]" />}
                            </div>
                          </div>
                          {t.description && (
                            <p className={`mt-1 pl-8 text-[10px] leading-snug ${isSelected ? 'text-[#0B3B2E]/70' : 'text-slate-400'}`}>
                              {t.description}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* message body */}
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Message Body</p>
                  {activeChannel === 'sms' && customBody && (
                    <span className={`text-[10px] font-bold tabular-nums ${smsInfo.segments > 1 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {smsInfo.chars} ch · {smsInfo.segments} SMS
                    </span>
                  )}
                </div>
                <textarea
                  rows={activeChannel === 'sms' ? 5 : 4}
                  value={customBody}
                  onChange={(e) => setCustomBody(e.target.value)}
                  placeholder={
                    activeChannel === 'sms'
                      ? 'Type your message… {tenantName}, {amount} etc. are resolved per recipient.'
                      : 'Type your email body…'
                  }
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E]/40 focus:bg-white focus:ring-2 focus:ring-[#0B3B2E]/10"
                />
                {activeChannel === 'sms' && customBody && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>{smsInfo.encoding}</span>
                      <span>{smsInfo.remaining} chars remaining</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          smsInfo.segments > 2 ? 'bg-red-500' : smsInfo.segments > 1 ? 'bg-amber-400' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${smsSegmentProgress(smsInfo)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* sender profile */}
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Sender Profile</p>
                {profileStatus ? (
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold ${
                      profileStatus.code === 'active'      ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                      profileStatus.code === 'configured'  ? 'border-blue-200   bg-blue-50   text-blue-700'    :
                                                             'border-amber-200   bg-amber-50   text-amber-700'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        profileStatus.code === 'active' ? 'bg-emerald-500' : profileStatus.code === 'configured' ? 'bg-blue-500' : 'bg-amber-500'
                      }`} />
                      {profileStatus.label || 'Profile'}
                    </span>
                    {profileStatus.reason && (
                      <span className="text-[11px] text-slate-400">{profileStatus.reason}</span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    No default {activeChannel === 'sms' ? 'SMS' : 'email'} profile configured.
                  </p>
                )}
              </div>

              {/* test SMS panel */}
              {activeChannel === 'sms' && (
                <div className="bg-white px-4 py-3">
                  <button
                    onClick={() => setShowTestPanel((prev) => !prev)}
                    className="flex w-full items-center justify-between text-[11px] font-bold text-slate-500 transition hover:text-slate-700"
                  >
                    <span className="flex items-center gap-2">
                      <FaVial className="text-[10px]" />
                      Send Test SMS
                    </span>
                    <FaChevronDown className={`text-[10px] transition-transform ${showTestPanel ? 'rotate-180' : ''}`} />
                  </button>
                  {showTestPanel && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="tel"
                        placeholder="+254712345678"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] outline-none focus:border-[#0B3B2E]/40 focus:ring-1 focus:ring-[#0B3B2E]/10"
                      />
                      <textarea
                        rows={2}
                        placeholder="Custom test message (optional)"
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] outline-none focus:border-[#0B3B2E]/40 focus:ring-1 focus:ring-[#0B3B2E]/10"
                      />
                      <button
                        onClick={handleTestSms}
                        disabled={testSending || !testPhone.trim()}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FaVial className="text-[10px]" />
                        {testSending ? 'Sending test…' : 'Send Test SMS'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* spacer */}
              <div className="flex-1" />

              {/* action buttons */}
              <div className="sticky bottom-0 border-t border-slate-200 bg-white px-4 py-3">
                <div className="flex gap-2">
                  <button
                    onClick={handlePreview}
                    disabled={previewLoading || loadingTemplates || !selectedTemplateKey}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaSyncAlt className={`text-[11px] ${previewLoading ? 'animate-spin' : ''}`} />
                    Refresh Preview
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={sending || previewLoading || !preview || sendableCount === 0}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0B3B2E] px-3 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FaPaperPlane className="text-[11px]" />
                    {sending ? 'Sending…' : `Send${sendableCount > 0 ? ` (${sendableCount})` : ''}`}
                  </button>
                </div>
              </div>
            </div>

            {/* ── RIGHT PANEL ── */}
            <div className="flex min-h-0 flex-col overflow-hidden bg-white">

              {/* stats strip */}
              <div className="grid grid-cols-2 gap-0 border-b border-slate-200 sm:grid-cols-4">
                <StatBox
                  label="Recipients"
                  value={normalizedIds.length}
                  icon={<FaUsers />}
                  color="slate"
                />
                <StatBox
                  label="Sendable"
                  value={preview ? sendableCount : '—'}
                  icon={<FaPaperPlane />}
                  color="green"
                />
                <StatBox
                  label="Blocked"
                  value={preview ? blockedCount : '—'}
                  icon={<FaLock />}
                  color={blockedCount > 0 ? 'red' : 'slate'}
                />
                {hasSendResults ? (
                  <StatBox label="Sent" value={sentCount} icon={<FaCheckCircle />} color="blue" />
                ) : (
                  <StatBox
                    label={activeChannel === 'sms' ? 'SMS Parts' : 'Attachments'}
                    value={activeChannel === 'sms' && smsInfo.segments > 0 ? smsInfo.segments : '—'}
                    icon={<FaSms />}
                    color="slate"
                  />
                )}
              </div>

              {/* blocked alert */}
              {preview && blockedCount > 0 && !hasSendResults && (
                <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 px-5 py-3">
                  <FaExclamationTriangle className="mt-0.5 shrink-0 text-[13px] text-amber-500" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-amber-800">
                      {blockedCount} recipient{blockedCount !== 1 ? 's' : ''} cannot receive this message
                    </p>
                    <p className="text-[11px] text-amber-600">
                      {activeChannel === 'sms'
                        ? 'Missing or invalid phone number. Update tenant contact details to include them.'
                        : 'Missing or invalid email address. Update contact details to include them.'}
                    </p>
                  </div>
                </div>
              )}

              {/* preview / recipients area */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {!preview && !previewLoading && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                      <ChIcon className="text-[22px]" />
                    </div>
                    <p className="text-[13px] font-semibold text-slate-500">No preview yet</p>
                    <p className="mt-1 text-[12px] text-slate-400">Select a template, then click Refresh Preview.</p>
                  </div>
                )}

                {previewLoading && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <FaSyncAlt className="mb-3 animate-spin text-[24px] text-slate-300" />
                    <p className="text-[12px] text-slate-400">Preparing preview…</p>
                  </div>
                )}

                {!previewLoading && previews.length > 0 && (
                  <div>
                    {/* sample message at top for SMS */}
                    {activeChannel === 'sms' && previews.length > 0 && (
                      <SampleMessagePanel
                        item={previews[Math.min(sampleIndex, previews.length - 1)]}
                        index={Math.min(sampleIndex, previews.length - 1)}
                        total={previews.length}
                        onPrev={() => setSampleIndex((p) => Math.max(0, p - 1))}
                        onNext={() => setSampleIndex((p) => Math.min(previews.length - 1, p + 1))}
                      />
                    )}

                    {/* recipient table header */}
                    <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                        Recipient ({previews.length})
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Contact</span>
                      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Status</span>
                    </div>

                    {/* recipient rows */}
                    <div className="divide-y divide-slate-100">
                      {previews.map((item) => {
                        const result   = hasSendResults
                          ? (preview?.results || []).find((r) => r.recordId === item.recordId)
                          : null;
                        const expanded = expandedPreviewId === item.recordId;
                        return (
                          <RecipientRow
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
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══ HISTORY TAB ══ */}
        {activeTab === 'history' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Channel:</p>
              {['all', 'sms', 'email'].map((f) => (
                <button
                  key={f}
                  onClick={() => setHistoryFilter(f)}
                  className={`rounded-xl border px-3 py-1.5 text-[11px] font-bold transition ${
                    historyFilter === f
                      ? 'border-[#0B3B2E] bg-[#0B3B2E] text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f.toUpperCase()}
                </button>
              ))}
              <button
                onClick={loadHistory}
                disabled={historyLoading}
                className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <FaSyncAlt className={`text-[10px] ${historyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {historyLoading && (
                <div className="flex items-center justify-center py-16 text-[12px] text-slate-400">
                  <FaSyncAlt className="mr-2 animate-spin" /> Loading history…
                </div>
              )}
              {!historyLoading && historyLogs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center text-[12px] text-slate-400">
                  <FaHistory className="mb-3 text-[24px] text-slate-200" />
                  No sent messages found. They will appear here after sending.
                </div>
              )}
              {!historyLoading && historyLogs.length > 0 && (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b-2 border-slate-200 bg-[#0B3B2E]/5">
                      {['Time', 'Ch.', 'Recipient', 'Template', 'Status', 'Msg ID', 'Preview'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.12em] text-[#0B3B2E]/70">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyLogs.map((log) => (
                      <tr key={log._id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtDateTime(log.sentAt || log.createdAt)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${
                            log.channel === 'sms' ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          }`}>
                            {log.channel === 'sms' ? <FaSms className="text-[9px]" /> : <FaEnvelope className="text-[9px]" />}
                            {String(log.channel || '').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{log.recipientName || '—'}</div>
                          <div className="text-[10px] text-slate-400">{log.to || '—'}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-slate-700">{log.templateName || contextLabel(log.contextType)}</div>
                          {log.isTest && <span className="text-[10px] font-bold text-violet-600">TEST</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={log.status} />
                          {log.error && (
                            <div className="mt-0.5 max-w-[120px] truncate text-[10px] text-red-500" title={log.error}>
                              {log.error}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[10px] text-slate-400">
                          {log.providerMessageId ? truncate(log.providerMessageId, 18) : '—'}
                        </td>
                        <td className="max-w-[220px] px-4 py-2.5 text-slate-600">{truncate(log.body, 70)}</td>
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

const StatBox = ({ label, value, icon, color }) => {
  const colors = {
    slate: { bg: 'bg-slate-50',   text: 'text-slate-800', sub: 'text-slate-400', icon: 'text-slate-400' },
    green: { bg: 'bg-emerald-50', text: 'text-emerald-800', sub: 'text-emerald-500', icon: 'text-emerald-500' },
    red:   { bg: 'bg-red-50',     text: 'text-red-800',   sub: 'text-red-400',   icon: 'text-red-400'   },
    blue:  { bg: 'bg-blue-50',    text: 'text-blue-800',  sub: 'text-blue-400',  icon: 'text-blue-400'  },
  };
  const c = colors[color] || colors.slate;
  return (
    <div className={`flex flex-col gap-1 border-r border-slate-200 last:border-r-0 px-5 py-4 ${c.bg}`}>
      <div className={`text-[11px] ${c.icon}`}>{icon}</div>
      <div className={`text-2xl font-black tabular-nums leading-none ${c.text}`}>{value}</div>
      <div className={`text-[10px] font-semibold ${c.sub}`}>{label}</div>
    </div>
  );
};

const SampleMessagePanel = ({ item, index, total, onPrev, onNext }) => {
  const info   = countSmsInfo(item?.body);
  const hasNav = total > 1;
  const initials = String(item?.recipientName || '—')
    .split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

  return (
    <div className="border-b border-slate-200 bg-white">

      {/* ── top bar: label + nav + status ── */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-2.5">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 flex-1">
          Message Preview
        </span>
        {hasNav && (
          <div className="flex items-center gap-1">
            <button onClick={onPrev} disabled={index === 0}
              className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">
              <FaChevronLeft size={8} />
            </button>
            <span className="min-w-[44px] text-center text-[11px] font-bold tabular-nums text-slate-600">
              {index + 1} / {total}
            </span>
            <button onClick={onNext} disabled={index === total - 1}
              className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">
              <FaChevronRight size={8} />
            </button>
          </div>
        )}
        <span className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-bold ${
          item?.canSend
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {item?.canSend ? <FaCheckCircle size={8} /> : <FaTimesCircle size={8} />}
          {item?.canSend ? 'Ready to Send' : 'Blocked'}
        </span>
      </div>

      {/* ── recipient strip ── */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#0B3B2E] text-[11px] font-black text-white">
          {initials || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-slate-900 truncate">{item?.recipientName || '—'}</p>
          {item?.recipientPhone
            ? <p className="flex items-center gap-1 text-[10px] text-slate-500"><FaPhone size={8} />{item.recipientPhone}</p>
            : <p className="text-[10px] text-red-500">No phone number</p>
          }
        </div>
        {/* sms tech specs */}
        <div className="flex shrink-0 items-center divide-x divide-slate-200 rounded border border-slate-200 bg-white text-[10px]">
          <span className={`px-2.5 py-1.5 font-bold ${info.segments > 1 ? 'text-amber-700' : 'text-slate-600'}`}>
            {info.segments} part{info.segments !== 1 ? 's' : ''}
          </span>
          <span className="px-2.5 py-1.5 text-slate-400">{info.encoding}</span>
          <span className="px-2.5 py-1.5 tabular-nums text-slate-400">{info.chars} ch</span>
        </div>
      </div>

      {/* ── message body ── */}
      <div className="px-5 py-4">
        <div className="relative rounded-lg border-l-4 border-[#0B3B2E] bg-slate-50 px-4 py-3.5 text-[12px] leading-[1.7] text-slate-800 whitespace-pre-wrap">
          {item?.body || '—'}
        </div>

        {/* char progress bar */}
        {info.chars > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${
                  info.segments > 2 ? 'bg-red-500' : info.segments > 1 ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, smsSegmentProgress(info))}%` }}
              />
            </div>
            <span className={`text-[10px] font-semibold tabular-nums ${
              info.segments > 1 ? 'text-amber-600' : 'text-slate-400'
            }`}>
              {info.remaining} remaining
            </span>
          </div>
        )}

        {/* warnings */}
        {item?.missingPlaceholders?.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2.5">
            <FaExclamationTriangle size={10} className="mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="text-[11px] font-bold text-red-800">Missing placeholder data</p>
              <p className="text-[10px] text-red-600">{item.missingPlaceholders.join(' · ')}</p>
            </div>
          </div>
        )}
        {!item?.canSend && item?.reason && !item?.missingPlaceholders?.length && (
          <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2.5">
            <FaLock size={9} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-[11px] font-semibold text-red-700">{item.reason}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const RecipientRow = ({ item, result, channel, expanded, onToggle }) => {
  const hasSent   = result?.status === 'sent';
  const hasFailed = result?.status === 'failed';

  let statusLabel, statusClass;
  if (hasSent)        { statusLabel = 'Sent';    statusClass = 'border-emerald-200 bg-emerald-50 text-emerald-700'; }
  else if (hasFailed) { statusLabel = 'Failed';  statusClass = 'border-red-200    bg-red-50    text-red-700';    }
  else if (!item.canSend) { statusLabel = 'Blocked'; statusClass = 'border-red-200    bg-red-50    text-red-700';    }
  else                { statusLabel = 'Ready';   statusClass = 'border-emerald-200 bg-emerald-50 text-emerald-700'; }

  const contact = channel === 'sms' ? item.recipientPhone : item.recipientEmail;

  return (
    <div>
      <button
        onClick={onToggle}
        className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 text-left transition hover:bg-slate-50 ${expanded ? 'bg-slate-50' : ''}`}
      >
        {/* name + preview */}
        <div className="min-w-0">
          <p className="truncate text-[12px] font-bold text-slate-900">{item.recipientName || 'Recipient'}</p>
          {!expanded && item.body && (
            <p className="truncate text-[11px] text-slate-400">{truncate(item.body, 60)}</p>
          )}
          {!item.canSend && item.reason && !expanded && (
            <p className="truncate text-[11px] text-red-500">{item.reason}</p>
          )}
        </div>

        {/* contact */}
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
          {channel === 'sms' ? <FaPhone className="text-[9px]" /> : <FaEnvelope className="text-[9px]" />}
          {contact || <span className="text-red-400">No {channel === 'sms' ? 'phone' : 'email'}</span>}
        </div>

        {/* status */}
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${statusClass}`}>
            {(hasSent || (item.canSend && !hasFailed)) ? (
              <FaCheckCircle className="text-[9px]" />
            ) : (
              hasFailed || !item.canSend ? <FaTimesCircle className="text-[9px]" /> : null
            )}
            {statusLabel}
          </span>
          <FaChevronDown className={`text-[10px] text-slate-300 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-2.5">
          {item.subject && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-400">SUBJECT  </span>
              <span className="text-[12px] font-semibold text-slate-800">{item.subject}</span>
            </div>
          )}
          {channel === 'sms' ? (
            <div className="rounded-xl bg-[#f0f0f5] p-3">
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-none bg-white px-3 py-2.5 text-[12px] leading-relaxed text-slate-800 shadow-sm whitespace-pre-wrap">
                  {item.body || 'No message body.'}
                </div>
              </div>
              {item.body && (() => {
                const info = countSmsInfo(item.body);
                return (
                  <p className="mt-2 text-right text-[10px] text-slate-400">
                    {info.chars} chars · {info.segments} SMS · {info.encoding}
                  </p>
                );
              })()}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-slate-800 whitespace-pre-wrap">
              {item.body || 'No message body.'}
            </div>
          )}
          {item.missingPlaceholders?.length > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600">
              <FaExclamationTriangle className="text-[10px]" />
              Missing values: {item.missingPlaceholders.join(', ')}
            </p>
          )}
          {!item.canSend && item.reason && (
            <p className="flex items-center gap-1.5 text-[11px] text-red-600">
              <FaLock className="text-[10px]" /> {item.reason}
            </p>
          )}
          {result?.messageId && (
            <p className="font-mono text-[11px] text-slate-400">Provider ID: {result.messageId}</p>
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

const StatusBadge = ({ status }) => {
  const map = {
    sent:    'border-emerald-200 bg-emerald-50 text-emerald-700',
    failed:  'border-red-200    bg-red-50    text-red-700',
    pending: 'border-amber-200  bg-amber-50  text-amber-700',
  };
  return (
    <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] font-bold ${map[status] || map.pending}`}>
      {String(status || 'pending').toUpperCase()}
    </span>
  );
};

export default CommunicationComposerModal;
