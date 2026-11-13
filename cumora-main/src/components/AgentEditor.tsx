import { useEffect, useRef, useState } from 'react'
import { api, getPairingServerOrigin, type AgentInput } from '@/api/client'
import { isNativePlatform } from '@/lib/native'
import { useParticipants } from '@/stores/participants'
import { useComputers } from '@/stores/computers'
import { useConversations } from '@/stores/conversations'
import { useAuth } from '@/stores/auth'
import { Input } from '@/components/Input'
import { AvatarCropper } from '@/components/AvatarCropper'
import { RoleConnectionFields } from './RoleConnectionFields'
import type { RoleConnectionInput, RoleConnectionState } from '../../shared/role-connection'
import { TextArea } from '@/components/TextArea'
import { Select } from '@/components/Select'
import { Combobox, type ComboboxOption } from '@/components/Combobox'
import { Checkbox } from '@/components/Checkbox'
import type { Participant, EngineId } from '@/types'
import { useT } from '@/lib/i18n'
import { catalogTrust } from '@/lib/engine-model-choices'
import { fastModeAvailable } from '@/lib/agent-fast-mode'
import { engineLabel } from '@/lib/engines'
import { parseAgentPersonality, serializeAgentPersonality } from '../../shared/agent-personality'

const INHERIT_ENGINE = '__inherit__'

function newCreateRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Which engine-dropdown value to show for a saved agent.
 *  Official production has no `engineInherit`: a stored engine that isn't
 *  the computer default means the user pinned it. */
function initialEngineChoice(agent: Participant | null, computer: { kind: string; availableEngines: EngineId[] } | undefined): string {
  if (!agent || !computer || computer.kind === 'cloud') return INHERIT_ENGINE
  if (agent.providerProfile) return 'claude'
  const advertised = computer.availableEngines
  const engine = agent.engine
  if (!engine || engine === 'managed' || !advertised.includes(engine)) return INHERIT_ENGINE
  if (agent.engineInherit === true) return INHERIT_ENGINE
  if (agent.engineInherit === false) return engine
  return engine === advertised[0] ? INHERIT_ENGINE : engine
}

const PALETTE = [
  '#FFB088', '#FFD9D2', '#FFB7AF', '#F4B740',
  '#7C5CFF', '#A593FF', '#4FC2F4', '#41B5DC',
  '#4FC2A1', '#6EC56A', '#E9A0E9', '#FF7AB6',
]

interface Props {
  /** if provided, edit mode; otherwise create mode */
  agent: Participant | null
  onClose: () => void
  /** Called after a successful save, once the modal is already closed. */
  onSaved?: () => void
  focusApi?: boolean
}

export function AgentEditor({ agent, onClose, onSaved, focusApi=false }: Props) {
  const t = useT()
  const editing = agent !== null
  const [tab,setTab] = useState<'persona'|'connection'>(focusApi?'connection':'persona')
  const [name, setName] = useState(agent?.name ?? '')
  const [role, setRole] = useState(agent?.role ?? '')
  const [personality, setPersonality] = useState(() => parseAgentPersonality(agent?.systemPrompt).personality)
  const [speakingStyle, setSpeakingStyle] = useState(() => parseAgentPersonality(agent?.systemPrompt).speakingStyle)
  const systemPrompt = serializeAgentPersonality({ personality, speakingStyle })
  const [bio, setBio] = useState(agent?.bio ?? '')
  const [avatarBg, setAvatarBg] = useState(agent?.avatarBg ?? PALETTE[0])
  const [providerProfile, setProviderProfile] = useState(agent?.providerProfile ?? '')
  const [connectionState,setConnectionState] = useState<RoleConnectionState|null>(null)
  const [connectionLoadError,setConnectionLoadError] = useState<string|null>(null)
  const [apiMode,setApiMode] = useState(false)
  const [connection,setConnection] = useState<RoleConnectionInput>({label:'自定义接口',protocol:'anthropic',baseUrl:'',model:'',fastModel:'',authType:'bearer',apiKey:''})
  const [connectionRevision,setConnectionRevision] = useState('')
  const [connectionTest,setConnectionTest] = useState<string|null>(null)
  const [testingConnection,setTestingConnection] = useState(false)
  const connectionSection = useRef<HTMLElement>(null)

  useEffect(()=>{
    let cancelled=false
    void api.getRoleConnection(agent?.id).then(state=>{
      if(cancelled)return
      setConnectionState(state)
      if(state.connection){setConnection({...state.connection,apiKey:''});setConnectionRevision(state.connection.revision)}
      setApiMode(state.enabled && (!!state.connection || !agent))
    }).catch(()=>{if(!cancelled)setConnectionLoadError('接口设置加载失败，请关闭后重试')})
    return ()=>{cancelled=true}
  },[agent?.id])
  const [model, setModel] = useState(agent?.model ?? '')
  const [fastModel, setFastModel] = useState(agent?.fastModel ?? '')
  const [nativeFastMode, setNativeFastMode] = useState(agent?.nativeFastMode ?? false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(agent?.avatarUrl ?? null)
  const [generatingAvatar, setGeneratingAvatar] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const preparingPhoto = cropFile !== null
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!avatarUrl?.startsWith('blob:')) return
    return () => URL.revokeObjectURL(avatarUrl)
  }, [avatarUrl])
  const [avatarErr, setAvatarErr] = useState<string | null>(null)
  const [repairCode, setRepairCode] = useState<string | null>(null)
  const [repairErr, setRepairErr] = useState<string | null>(null)
  const [repairCopied, setRepairCopied] = useState(false)
  // Survives an ambiguous network failure and the user's retry click, but a
  // newly opened editor gets a fresh key. The server binds it to the payload.
  const createRequestId = useRef(newCreateRequestId())

  // "Runs on" — which Computer hosts this agent. Cloud = managed engine.
  // Free tier is BYOA-only: it has no real Cumora Cloud computer; we show a
  // LOCKED "Cumora Cloud (Pro)" upsell instead and never default/select it.
  const activeTier = useAuth((s) => s.companies.find((c) => c.id === s.activeCompanyId)?.tier)
  const isFreeTier = activeTier === 'free'
  const computersById = useComputers((s) => s.byId)
  const computers = Object.values(computersById)
    .sort((a, b) => (a.kind === 'cloud' ? 0 : 1) - (b.kind === 'cloud' ? 0 : 1) || a.name.localeCompare(b.name))
  const cloud = computers.find((c) => c.kind === 'cloud')
  const firstByoa = computers.find((c) => c.kind !== 'cloud')
  // Default for a NEW agent: paid → Cumora Cloud; free → first paired computer.
  const [computerId, setComputerId] = useState(agent?.computerId ?? (isFreeTier ? firstByoa?.id : cloud?.id) ?? '')
  const [engineChoice, setEngineChoice] = useState(
    initialEngineChoice(agent, agent?.computerId ? computersById[agent.computerId] : undefined),
  )
  const engineTouched = useRef(false)
  const selectedComputer = computerId ? computersById[computerId] : undefined
  const isByoa = !!selectedComputer && selectedComputer.kind !== 'cloud'
  const selectedEngineId: EngineId = (
    engineChoice !== INHERIT_ENGINE
      ? engineChoice
      : (selectedComputer?.availableEngines[0] ?? 'claude')
  ) as EngineId
  const selectedComputerOffline = isByoa && selectedComputer.status !== 'online'
  const detectedEngine = selectedComputer?.detectedEngines?.find((engine) => engine.id === selectedEngineId)
  const profiles = detectedEngine?.providerProfiles ?? []
  const selectedProfile = profiles.find((p) => p.id === providerProfile)
  const modelCatalog = providerProfile ? {
    models: [], defaultModel: selectedProfile?.model, defaultFastModel: selectedProfile?.fastModel,
    supportsCustom: true, fastModelScope: 'agent', stale: false,
  } : detectedEngine?.modelCatalog
  // Per-computer engine model defaults (configured on the Computer card).
  // When the local CLI catalog can't name a default (e.g. custom endpoints),
  // these Cumora-side settings show as the hint for "follow engine default".
  // A profile's endpoint owns its own namespace, so the engine-wide default
  // must not be offered there — the server does not apply it either.
  const engineDefaults = providerProfile ? undefined : selectedComputer?.engineDefaults?.[selectedEngineId]
  const engineDefaultModel = engineDefaults?.model ?? undefined
  const engineDefaultFastModel = engineDefaults?.fastModel ?? undefined
  // A `presets` catalog is the daemon's fallback, not a listing, and an
  // `unverified` one came from a daemon that merged its presets into a real
  // listing. Neither can name a model this account is known to run, so neither
  // offers rows; the field says which happened instead.
  const modelCatalogTrust = isByoa ? catalogTrust(modelCatalog) : 'missing'
  const showNativeFastMode = isByoa && (selectedEngineId === 'codex' || selectedEngineId === 'claude')
  // Fast Mode is not a suggestion, so it reads the whole catalog rather than
  // the vouched-for rows above: dropping a known default or a
  // `supportsFastMode: false` would flip an existing Agent's setting on its next
  // save, which writes whatever this computes. See the module for both cases.
  const nativeFastModeSupported = fastModeAvailable({
    engine: selectedEngineId,
    model,
    engineDefault: engineDefaultModel,
    catalog: modelCatalog,
  })
  // A configured computer default is authoritative, so it needs no label. The
  // catalog's default is only this computer's CLI setting — a deployment pin can
  // still win — so that one names its source instead of promising the model, and
  // it is quoted only when the catalog itself can be vouched for.
  const reportedDefault = (reported: string | null | undefined) =>
    modelCatalogTrust === 'reported' && reported ? t('agent.modelLocalDefault', { model: reported }) : undefined
  // The Cumora-side pin is applied by the server, so it is quoted even when the
  // catalog is not: it is the value that actually runs.
  const modelOptions: Array<ComboboxOption<string>> = [
    {
      value: '',
      label: t('agent.followEngineDefault'),
      hint: engineDefaultModel ?? reportedDefault(modelCatalog?.defaultModel),
    },
    ...(modelCatalogTrust === 'reported' ? modelCatalog?.models ?? [] : []).map((option) => ({
      value: option.id,
      label: option.label,
      hint: [
        option.label !== option.id ? option.id : null,
        option.recommendedFor?.includes('big') ? t('agent.recommended') : null,
      ].filter(Boolean).join(' · ') || undefined,
    })),
  ]
  const fastModelOptions: Array<ComboboxOption<string>> = [
    {
      value: '',
      label: t('agent.followSmallBrainDefault'),
      hint: engineDefaultFastModel ?? reportedDefault(modelCatalog?.defaultFastModel),
    },
    ...(modelCatalogTrust === 'reported' ? modelCatalog?.models ?? [] : []).map((option) => ({
      value: option.id,
      label: option.label,
      hint: [
        option.label !== option.id ? option.id : null,
        option.recommendedFor?.includes('small') ? t('agent.recommended') : null,
      ].filter(Boolean).join(' · ') || undefined,
    })),
  ]
  const catalogNotice = !isByoa ? ''
    : modelCatalog?.stale ? t('agent.modelCatalogStale')
      : modelCatalogTrust === 'guessed' ? t('agent.modelCatalogGuessed')
      : modelCatalogTrust === 'unverified' ? t('agent.modelCatalogUnverified')
        : ''
  const origin = getPairingServerOrigin()
  const repairCommand = repairCode
    ? `npx cumora@latest agent computer --pair ${repairCode}${origin ? ` --server ${origin}` : ''}`
    : ''

  useEffect(() => { void useComputers.getState().refresh() }, [])
  useEffect(() => {
    if (!agent || engineTouched.current) return
    const host = agent.computerId ? computersById[agent.computerId] : undefined
    if (!host) return
    setEngineChoice(initialEngineChoice(agent, host))
  }, [agent, computersById])
  useEffect(() => {
    setRepairCopied(false)
    setRepairErr(null)
    setRepairCode(null)
    if (!selectedComputerOffline || !selectedComputer) return

    let cancelled = false
    void api.repairComputer(selectedComputer.id)
      .then((out) => { if (!cancelled) setRepairCode(out.code) })
      .catch((e) => {
        if (!cancelled) setRepairErr(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [selectedComputer?.id, selectedComputerOffline])
  useEffect(() => {
    if (!repairCopied) return
    const t = window.setTimeout(() => setRepairCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [repairCopied])
  // Default selection once the list loads (new agents): paid → Cumora Cloud,
  // free → the first paired computer (never cloud).
  useEffect(() => {
    if (computerId) return
    if (isFreeTier && firstByoa) { setComputerId(firstByoa.id); setEngineChoice(INHERIT_ENGINE) }
    else if (!isFreeTier && cloud) { setComputerId(cloud.id); setEngineChoice(INHERIT_ENGINE) }
  }, [cloud, firstByoa, computerId, isFreeTier])

  // Model pins and paid speed preferences belong to the selected engine/account.
  const clearModelPins = (): void => {
    setModel('')
    setFastModel('')
    setNativeFastMode(false)
  }

  const changeComputer = (id: string): void => {
    if (id === computerId) return
    engineTouched.current = true
    setComputerId(id)
    setProviderProfile('')
    setEngineChoice(INHERIT_ENGINE)
    clearModelPins()
  }

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !cropFile) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, cropFile])

  const connectionChanged = !agent?.providerProfile || agent.engine!=='api' || !connectionState?.connection || (['label','protocol','baseUrl','model','authType'] as const).some(k=>connection[k]!==connectionState.connection![k]) || (connection.fastModel||connection.model)!==(connectionState.connection?.fastModel||connectionState.connection?.model) || !!connection.apiKey
  const submit = async () => {
    setErr(null)
    setBusy(true)
    try {
      if(!connectionState || connectionLoadError) throw new Error(connectionLoadError || '接口设置仍在加载，请稍候')
      let chosenProfile = apiMode ? providerProfile : ''
      let target = computerId || cloud?.id
      if(apiMode && connectionChanged) {
        setTab('connection')
        setConnectionTest('正在测试模型和聊天工具…')
        const checked=await api.testRoleConnection({agentId:agent?.id,draftId:createRequestId.current,revision:connectionRevision,connection})
        setConnectionTest(checked.message)
        const prepared=await api.prepareRoleConnection({agentId:agent?.id,draftId:createRequestId.current,revision:connectionRevision,connection})
        chosenProfile=prepared.providerProfile;target=prepared.computerId
        setConnectionRevision(prepared.connection.revision)
      }
      const current = agent?.computerId ?? cloud?.id
      const targetComputer = target ? computersById[target] : undefined
      const isByoaTarget = !!targetComputer && targetComputer.kind !== 'cloud'
      const inherit = false
      const pinned: EngineId = apiMode ? 'api' : 'codex'
      const savedChoice = initialEngineChoice(agent, targetComputer)
      const inheritChanged = isByoaTarget && inherit !== (savedChoice === INHERIT_ENGINE)
      const engineChanged = isByoaTarget && !inherit && pinned !== ((agent?.engine as EngineId) ?? null)
      const assignmentChanged = Boolean(target && (target !== current || inheritChanged || engineChanged || chosenProfile !== (agent?.providerProfile ?? '')))
      const payload: AgentInput = {
        name, role, systemPrompt, bio, avatarBg,
        model: (apiMode?connection.model:model).trim() || null,
        fastModel: (apiMode?connection.fastModel||connection.model:fastModel).trim() || null,
        nativeFastMode: !apiMode && showNativeFastMode && nativeFastModeSupported && nativeFastMode,
      }
      // A host/engine change persists these pins in the assignment's single
      // SQL UPDATE. Do not clear them earlier if that assignment may fail.
      const profilePayload = assignmentChanged
        ? { ...payload, model: undefined, fastModel: undefined, nativeFastMode: undefined }
        : payload
      let agentId = agent?.id
      if (editing) {
        const savedAvatarUrl = photoFile ? (await api.uploadAgentAvatar(agent!.id, photoFile)).url : avatarUrl
        // Only send avatarUrl on change so we don't clobber it on no-op edits.
        if ((agent!.avatarUrl ?? null) !== savedAvatarUrl) profilePayload.avatarUrl = savedAvatarUrl
        await api.updateAgent(agent!.id, profilePayload)
      } else {
        // Creation + initial host/engine assignment is one transaction. The
        // stable request id makes retry-after-timeout return that same Agent.
        const created = await api.createAgent({
          ...payload,
          requestId: createRequestId.current,
          computerId: target || null,
          providerProfile: chosenProfile || null,
          engine: isByoaTarget ? pinned : undefined,
          inherit: isByoaTarget ? inherit : false,
        })
        agentId = created.id
        if (isByoaTarget && pinned && created.engine !== pinned) {
          throw new Error(t('agent.enginePinRejected', { engine: engineLabel(pinned) }))
        }
      }
      // Persist the host assignment when the computer OR the engine changed.
      // (Engine lives in the same assign call; gating only on the computer
      // would silently drop a Claude→Codex switch on the same machine.) Still
      // skipped on a plain style edit to avoid the owner/admin-gated call.
      if (editing && agentId && target && assignmentChanged) {
        const out = await api.assignAgentComputer(
          agentId,
          target,
          isByoaTarget ? pinned : undefined,
          isByoaTarget ? inherit : false,
          payload.model,
          payload.fastModel,
          chosenProfile || null,
          payload.nativeFastMode,
        )
        if (isByoaTarget && pinned && out.engine !== pinned) {
          throw new Error(t('agent.enginePinRejected', { engine: engineLabel(pinned) }))
        }
      }
      onClose()
      if (onSaved) {
        onSaved()
      } else {
        void useParticipants.getState().refresh()
        void useConversations.getState().reload()
      }
    } catch (e) {
      setConnectionTest(null)
      setErr(e instanceof Error ? e.message : String(e))
      if(agent && apiMode) void api.getRoleConnection(agent.id).then(s=>setConnectionRevision(s.connection?.revision ?? '')).catch(()=>{})
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    setTestingConnection(true);setConnectionTest(null)
    try {const result=await api.testRoleConnection({agentId:agent?.id,draftId:createRequestId.current,revision:connectionRevision,connection});setConnectionTest(result.message)}
    catch(e){setConnectionTest(e instanceof Error?e.message:'连接检查失败')}
    finally{setTestingConnection(false)}
  }

  const initial = (name || agent?.id || '?').charAt(0).toUpperCase()

  const selectPhoto = async (file?: File) => {
    if (!file) return
    setAvatarErr(null)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarErr(t('agent.photoTypeError')); return
    }
    if (file.size > 10 * 1024 * 1024) { setAvatarErr(t('agent.photoSizeError')); return }
    setCropFile(file)
  }

  const generateAvatar = async () => {
    if (!editing || !agent) return
    setAvatarErr(null)
    setGeneratingAvatar(true)
    try {
      // First save any pending edits so the prompt reflects what the user typed.
      await api.updateAgent(agent.id, { name, role, systemPrompt, bio, avatarBg })
      const r = await api.generateAgentAvatar(agent.id)
      setPhotoFile(null)
      setAvatarUrl(r.url)
      await useParticipants.getState().refresh()
    } catch (e) {
      setAvatarErr(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingAvatar(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6"
      style={{ background: 'rgba(15, 30, 50, 0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="bg-cloud rounded-[18px] shadow-pop w-full max-w-[560px] max-h-[90vh] flex flex-col overflow-hidden"
        style={{ border: '1px solid var(--ink-100)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-ink-100 flex items-center gap-3 shrink-0">
          <div
            className="w-12 h-12 rounded-full grid place-items-center text-white font-bold text-[18px] shrink-0 overflow-hidden relative"
            style={{ background: avatarUrl ? 'transparent' : avatarBg }}
          >
            {avatarUrl
              ? <img src={avatarUrl} alt={name || initial} className="absolute inset-0 w-full h-full object-cover" />
              : initial}
          </div>
          <div className="flex-1">
            <h2 className="font-display font-medium text-[20px] tracking-tight">
              {editing ? t('agent.editAgent', { name: agent!.name }) : t('agent.newAgent')}
            </h2>
            <div className="text-[12.5px] text-ink-500 italic font-display">
              {editing ? t('agent.editSubtitle') : t('agent.newSubtitle')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full grid place-items-center text-ink-500 hover:bg-sky2-50 hover:text-ink-900 transition"
            aria-label={t('common.close')}
          >×</button>
        </div>

        <div role="tablist" aria-label="角色设置" className="flex gap-6 px-6 border-b border-ink-100 shrink-0">
          {([['persona','角色设定'],['connection','模型连接']] as const).map(([id,label])=><button key={id} role="tab" type="button" aria-selected={tab===id} onClick={()=>setTab(id)} className={`py-3 text-[13px] border-b-2 ${tab===id?'border-skype text-skype-deep':'border-transparent text-ink-500'}`}>{label}</button>)}
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div hidden={tab!=='persona'} className="space-y-4">
          <Field label={t('agent.nameLabel')} hint={t('agent.nameHint')}>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('agent.namePh')}
            />
          </Field>

          <Field label={t('agent.roleLabel')} hint={t('agent.roleHint')}>
            <Input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t('agent.rolePh')}
            />
          </Field>

          <Field label={t('agent.personalityLabel')} hint={t('agent.personalityHint')}>
            <TextArea
              aria-label={t('agent.personalityLabel')}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              rows={4}
              placeholder={t('agent.personalityPh')}
            />
          </Field>

          <Field label={t('agent.styleLabel')} hint={t('agent.styleHint')}>
            <TextArea
              aria-label={t('agent.styleLabel')}
              value={speakingStyle}
              onChange={(e) => setSpeakingStyle(e.target.value)}
              rows={4}
              placeholder={t('agent.stylePh')}
            />
          </Field>
          <p className="text-[12px] leading-relaxed text-ink-500">{t('agent.discussionHint')}</p>

          <Field label={t('agent.bioLabel')} hint={t('agent.bioHint')}>
            <TextArea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              placeholder={t('agent.bioPh')}
            />
          </Field>

          </div>
          <div hidden={tab!=='connection'} className="space-y-4">
          {connectionLoadError && <p role="alert" className="text-[12px] text-coral-deep">{connectionLoadError}</p>}
          {connectionState?.enabled && <section ref={connectionSection} className="rounded-xl border border-ink-100 p-4 space-y-4" aria-label="模型接口">
            <div><h3 className="text-[15px] font-semibold">模型接口</h3><p className="mt-1 text-[12px] text-ink-400">{apiMode?'由 Cumora 直接调用，测试通过后应用到这个角色':'沿用本机 Codex 的登录状态和模型权限'}</p></div>
            <div className="flex gap-2">
              <button type="button" disabled={busy||testingConnection} aria-pressed={apiMode} onClick={()=>setApiMode(true)} className={`flex-1 rounded-lg py-2 text-[12px] ${apiMode?'bg-skype text-white':'bg-paper text-ink-600'}`}>模型 API</button>
              <button type="button" disabled={busy||testingConnection} aria-pressed={!apiMode} onClick={()=>{setApiMode(false);setProviderProfile('');engineTouched.current=true;setEngineChoice('codex');const host=computers.find(c=>c.availableEngines.includes('codex'));if(host)setComputerId(host.id);clearModelPins()}} className={`flex-1 rounded-lg py-2 text-[12px] ${!apiMode?'bg-skype text-white':'bg-paper text-ink-600'}`}>使用本机 Codex</button>
            </div>
            {apiMode ? <RoleConnectionFields value={connection} onChange={value=>{setConnection(value);setConnectionTest(null);setErr(null)}} hasKey={!!connectionState.connection?.hasKey} disabled={busy||testingConnection} testing={testingConnection} result={connectionTest} onTest={()=>void testConnection()} onLoadModels={async()=> (await api.listRoleModels({agentId:agent?.id,draftId:createRequestId.current,revision:connectionRevision,connection})).models}/>
              : <p className="text-[12px] text-ink-500">使用本机已登录的 Codex，模型调用仍由 Codex 处理</p>}
          </section>}

          {!apiMode && <>
          {isByoa && selectedEngineId === 'claude' && (profiles.length > 0 || providerProfile) && (
            <Field label={t('agent.providerLabel')} hint={t('agent.providerHint')}>
              <Select
                ariaLabel={t('agent.providerLabel')}
                value={providerProfile}
                onValueChange={(value) => {
                  setProviderProfile(value)
                  if (value) { engineTouched.current = true; setEngineChoice('claude') }
                  clearModelPins()
                }}
                options={[
                  { value: '', label: t('agent.providerDefault') },
                  ...profiles.map((p) => ({ value: p.id, label: p.label })),
                  ...(providerProfile && !selectedProfile
                    ? [{ value: providerProfile, label: t('agent.providerMissing', { id: providerProfile }), disabled: true }] : []),
                ]}
              />
            </Field>
          )}

          <Field
            label={isByoa ? t('agent.modelLabelByoa') : t('agent.modelLabel')}
            hint={isByoa
              ? [t('agent.modelHintByoaCatalog'), catalogNotice].filter(Boolean).join(' ')
              : t('agent.modelHintCloud')}
          >
            {isByoa ? (
              <Combobox
                ariaLabel={t('agent.modelLabelByoa')}
                value={model}
                onValueChange={setModel}
                options={modelOptions}
                searchPlaceholder={t('agent.searchModels')}
                allowCustom={modelCatalog?.supportsCustom !== false}
                customLabel={(value) => t('agent.useCustomModel', { model: value })}
              />
            ) : (
              <Input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={t('agent.defaultPh')}
                className="font-mono"
                spellCheck={false}
              />
            )}
          </Field>

          {showNativeFastMode && (
            <Checkbox
              checked={nativeFastModeSupported && nativeFastMode}
              onCheckedChange={setNativeFastMode}
              disabled={!nativeFastModeSupported}
              label={t('agent.nativeFastModeLabel')}
              description={!nativeFastModeSupported
                ? t(selectedEngineId === 'claude' ? 'agent.nativeFastModeClaudeUnsupported' : 'agent.nativeFastModeUnsupported')
                : t(selectedEngineId === 'claude' ? 'agent.nativeFastModeClaudeHint' : 'agent.nativeFastModeCodexHint')}
            />
          )}

          {isByoa && (!modelCatalog || modelCatalog.fastModelScope === 'agent') && (
            <Field
              label={t('agent.fastLabelByoa')}
              hint={[t('agent.fastHintByoaCatalog'), catalogNotice].filter(Boolean).join(' ')}
            >
              <Combobox
                ariaLabel={t('agent.fastLabelByoa')}
                value={fastModel}
                onValueChange={setFastModel}
                options={fastModelOptions}
                searchPlaceholder={t('agent.searchModels')}
                allowCustom={modelCatalog?.supportsCustom !== false}
                customLabel={(value) => t('agent.useCustomModel', { model: value })}
              />
            </Field>
          )}

          <Field
            label={t('agent.runsOnLabel')}
            hint="选择已配对且安装了 Codex 的电脑"
          >
            <Select
              ariaLabel={t('agent.runsOnLabel')}
              value={computerId}
              onValueChange={changeComputer}
              options={[
                // Free tier has no real Cumora Cloud computer — filter any out
                // (defensive) and append a locked Pro upsell entry instead.
                // NOT on native: App Store Guideline 3.1.1 forbids referencing
                // a paid tier that isn't purchasable in-app via IAP, so the
                // iOS/Android builds omit the upsell entirely.
                ...computers
                  .filter((c) => c.kind!=='cloud'&&c.availableEngines.includes('codex'))
                  .map((c) => ({
                    value: c.id,
                    label: `${c.kind === 'cloud' ? '☁' : c.kind === 'vps' ? '🖥' : '💻'} ${c.name}`
                      + (c.kind !== 'cloud' && c.status !== 'online' ? ` ${t('agent.offlineSuffix')}` : ''),
                  })),
                ...(false && isFreeTier && !isNativePlatform()
                  ? [{ value: '__cloud_pro__', label: t('agent.upgradeToPro'), disabled: true }]
                  : []),
              ]}
            />
            {selectedComputerOffline && (
              <div
                className="mt-3 rounded-[12px] p-3"
                style={{ background: 'var(--sky-50)', border: '1px solid var(--sky-100)' }}
              >
                <div className="text-[12px] font-semibold text-ink-900 mb-1">
                  {t('agent.computerOfflineMsg', { name: selectedComputer?.name ?? '' })}
                </div>
                {repairErr ? (
                  <div className="text-[11.5px] text-coral-deep bg-coral-soft rounded-[8px] p-2">{repairErr}</div>
                ) : repairCommand ? (
                  <>
                    <pre className="bg-ink-900 text-cloud rounded-[9px] p-2.5 text-[11.5px] overflow-x-auto whitespace-pre-wrap break-all font-mono select-all">
                      {repairCommand}
                    </pre>
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard?.writeText(repairCommand); setRepairCopied(true) }}
                      className="mt-2 inline-flex items-center justify-center min-w-[108px] text-[11.5px] font-semibold px-3 py-1.5 rounded-[9px] text-white transition-colors duration-200"
                      style={{ background: repairCopied ? '#3BB273' : 'var(--skype)' }}
                    >
                      {repairCopied ? t('agent.copied') : t('agent.copyCommand')}
                    </button>
                  </>
                ) : (
                  <div className="text-[11.5px] text-ink-400">{t('agent.generatingReconnect')}</div>
                )}
              </div>
            )}
          </Field>

          </>}
          </div>
          <div hidden={tab!=='persona'} className="space-y-4">
          <Field label={t('agent.avatarColorLabel')} hint={t('agent.avatarColorHint')}>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAvatarBg(c)}
                  className="w-8 h-8 rounded-full transition"
                  style={{
                    background: c,
                    boxShadow: avatarBg === c
                      ? '0 0 0 3px var(--cloud), 0 0 0 5px var(--skype)'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                  }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>

          <Field
            label={t('agent.aiPortraitLabel')}
            hint={editing ? t('agent.aiPortraitHintEdit') : t('agent.aiPortraitHintNew')}
          >
            <div className="flex items-center gap-4">
              {/* Avatar preview with breathing/sparkle animation while generating */}
              <div className="messenger-avatar-preview relative shrink-0" style={{ width: 88, height: 88 }}>
                {/* Soft outer glow that breathes */}
                {generatingAvatar && (
                  <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      inset: -8,
                      background: 'conic-gradient(from 0deg, #FFB088, #7C5CFF, #4FC2F4, #6EC56A, #FFB088)',
                      filter: 'blur(8px)',
                      opacity: 0.55,
                      animation: 'ae-spin 3s linear infinite, ae-breathe 1.6s ease-in-out infinite',
                    }}
                  />
                )}
                {/* Avatar bubble */}
                <div
                  className="absolute inset-0 rounded-full grid place-items-center text-white font-bold text-[28px]"
                  style={{
                    background: avatarUrl ? 'transparent' : avatarBg,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
                    transform: generatingAvatar ? undefined : 'scale(1)',
                    animation: generatingAvatar ? 'ae-pop 1.6s cubic-bezier(.36,1.6,.4,1) infinite' : undefined,
                  }}
                >
                  {avatarUrl
                    ? <img src={avatarUrl} alt={name || initial} className="absolute inset-0 w-full h-full object-cover rounded-full" />
                    : initial}
                  {/* Diagonal shimmer sweep */}
                  {generatingAvatar && (
                    <div
                      className="absolute inset-0 rounded-full pointer-events-none overflow-hidden"
                    >
                      <div
                        className="absolute"
                        style={{
                          inset: '-50%',
                          background: 'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)',
                          animation: 'ae-sheen 2.2s cubic-bezier(.4,0,.2,1) infinite',
                        }}
                      />
                    </div>
                  )}
                </div>
                {/* Twinkling sparkles ✦ */}
                {generatingAvatar && (
                  <>
                    <span className="absolute text-whisper select-none pointer-events-none"
                      style={{ top: -2, right: 6, fontSize: 14, animation: 'ae-twinkle 1.4s ease-in-out infinite', animationDelay: '0s' }}>✦</span>
                    <span className="absolute text-skype-deep select-none pointer-events-none"
                      style={{ bottom: 4, left: -4, fontSize: 11, animation: 'ae-twinkle 1.4s ease-in-out infinite', animationDelay: '0.45s' }}>✦</span>
                    <span className="absolute text-gold select-none pointer-events-none"
                      style={{ top: '40%', left: -6, fontSize: 9, animation: 'ae-twinkle 1.4s ease-in-out infinite', animationDelay: '0.9s' }}>✦</span>
                  </>
                )}
              </div>

              <div className="flex-1 flex flex-col gap-2 min-w-0">
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  aria-label={t('agent.uploadPhoto')}
                  onChange={(event) => { void selectPhoto(event.target.files?.[0]); event.target.value = '' }} />
                <button type="button" onClick={() => photoInput.current?.click()}
                  disabled={!editing || busy || preparingPhoto || generatingAvatar}
                  className="self-start px-3.5 py-2 rounded-[10px] text-[12.5px] font-semibold bg-ink-100 text-ink-900 disabled:opacity-50">
                  {preparingPhoto ? t('agent.preparingPhoto') : t('agent.uploadPhoto')}
                </button>
                <p className="text-[12px] text-ink-500">{photoFile ? t('agent.photoPending') : t('agent.photoHint')}</p>
                <button
                  type="button"
                  onClick={generateAvatar}
                  disabled={!editing || generatingAvatar || preparingPhoto || busy || !!photoFile}
                  className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-[12.5px] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    // Hardcoded purple — this button intentionally keeps the
                    // old AI-portrait accent, decoupled from the whisper
                    // palette which has since moved to sage. Don't switch
                    // back to var(--whisper) here.
                    background: editing
                      ? 'linear-gradient(135deg, #7C5CFF, #4A2D9E)'
                      : 'var(--ink-100)',
                    color: editing ? 'white' : 'var(--ink-500)',
                    boxShadow: editing && !generatingAvatar ? '0 4px 12px -3px rgba(124, 92, 255, 0.45)' : 'none',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={generatingAvatar ? { animation: 'ae-icon-twinkle 1.2s ease-in-out infinite', transformOrigin: 'center' } : undefined}>
                    <path d="M12 2l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>
                  </svg>
                  {generatingAvatar
                    ? <span>{t('agent.painting')}<span className="ae-dots" /></span>
                    : (avatarUrl ? t('agent.regenerate') : t('agent.generateAi'))}
                </button>

                {generatingAvatar && (
                  <div className="text-[11.5px] text-whisper-deep font-display italic leading-[1.5]">
                    {t('agent.composingPortrait', { name: name || t('agent.composingPortraitFallback') })}
                  </div>
                )}

                {avatarUrl && !generatingAvatar && !preparingPhoto && !busy && (
                  <button
                    type="button"
                    onClick={() => { setPhotoFile(null); setAvatarUrl(null) }}
                    className="self-start text-[11.5px] text-ink-500 hover:text-coral-deep transition"
                  >{t('agent.clearPortrait')}</button>
                )}

                {avatarErr && (
                  <div className="text-[11.5px] text-coral-deep bg-coral-soft py-1.5 px-2 rounded-md leading-[1.4]">
                    {avatarErr}
                  </div>
                )}
              </div>
            </div>
          </Field>

          </div>
          {err && (
            <div className="text-[12.5px] text-coral-deep bg-coral-soft py-2 px-3 rounded-lg">
              {err}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-ink-100 flex items-center gap-2 bg-paper shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[9px] text-[12.5px] font-semibold text-ink-700 bg-cloud hover:bg-sky2-50 transition"
            style={{ border: '1px solid var(--ink-100)' }}
          >{t('agent.cancelBtn')}</button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={submit}
            disabled={busy || testingConnection || !connectionState || !!connectionLoadError || preparingPhoto || generatingAvatar || !name.trim() || !systemPrompt.trim()}
            className="px-5 py-2 rounded-[9px] text-[12.5px] font-semibold text-white transition disabled:opacity-50"
            style={{
              background: 'var(--skype)',
              boxShadow: '0 4px 12px -3px rgba(0, 168, 240, 0.5)',
            }}
          >
            {busy ? t('agent.saving') : (apiMode && connectionChanged ? '测试并保存' : editing ? t('agent.saveChanges') : t('agent.createAgent'))}
          </button>
        </div>
      </div>

      {cropFile && <AvatarCropper file={cropFile}
        onCancel={() => setCropFile(null)}
        onConfirm={file => {
          setPhotoFile(file)
          setAvatarUrl(URL.createObjectURL(file))
          setCropFile(null)
        }} />}
      <style>{`
        /* === avatar generation animations === */
        @keyframes ae-spin   { to { transform: rotate(360deg); } }
        @keyframes ae-breathe {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50%      { opacity: 0.75; transform: scale(1.08); }
        }
        @keyframes ae-pop {
          0%, 100% { transform: scale(1); }
          40%      { transform: scale(1.04); }
          70%      { transform: scale(0.985); }
        }
        @keyframes ae-sheen {
          0%   { transform: translateX(-60%) translateY(-60%) rotate(0deg); }
          100% { transform: translateX(60%)  translateY(60%)  rotate(0deg); }
        }
        @keyframes ae-twinkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
        @keyframes ae-icon-twinkle {
          0%, 100% { opacity: 0.7; transform: scale(0.92); }
          50%      { opacity: 1;   transform: scale(1.08); }
        }
        @keyframes ae-dot {
          0%, 20%  { opacity: 0; }
          50%      { opacity: 1; }
          80%, 100%{ opacity: 0; }
        }
        .ae-dots::after {
          content: '...';
          letter-spacing: 2px;
          display: inline-block;
          margin-left: 2px;
          animation: ae-dot 1.4s steps(4, end) infinite;
        }
      `}</style>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold tracking-wider uppercase text-ink-500 mb-1">{label}</label>
      {hint && <div className="text-[11.5px] text-ink-300 mb-1.5 font-display italic">{hint}</div>}
      {children}
    </div>
  )
}
