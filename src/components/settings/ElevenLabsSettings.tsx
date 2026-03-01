import { useState, useEffect, useCallback } from "react";
import {
  Volume2, Mic, Save, Loader2, CheckCircle2, Eye, EyeOff, Play, Square, RefreshCw,
  AudioLines, Globe, Gauge, Wand2, FileAudio, Languages
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

// ── Voice catalog ──
const VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", tags: ["Feminino", "Suave"], lang: "Multi" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", tags: ["Masculino", "Quente"], lang: "Multi" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", tags: ["Masculino", "Confiante"], lang: "Multi" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", tags: ["Feminino", "Natural"], lang: "Multi" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", tags: ["Masculino", "Casual"], lang: "Multi" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", tags: ["Masculino", "Intenso"], lang: "Multi" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", tags: ["Não-binário", "Calmo"], lang: "Multi" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", tags: ["Masculino", "Articulado"], lang: "Multi" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", tags: ["Feminino", "Britânico"], lang: "Multi" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", tags: ["Feminino", "Amigável"], lang: "Multi" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", tags: ["Masculino", "Amigável"], lang: "Multi" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", tags: ["Feminino", "Expressiva"], lang: "Multi" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", tags: ["Masculino", "Amigável"], lang: "Multi" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris", tags: ["Masculino", "Casual"], lang: "Multi" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", tags: ["Masculino", "Narração"], lang: "Multi" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", tags: ["Masculino", "Britânico"], lang: "Multi" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", tags: ["Feminino", "Britânico"], lang: "Multi" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", tags: ["Masculino", "Documentário"], lang: "Multi" },
];

const TTS_MODELS = [
  { id: "eleven_multilingual_v2", name: "Multilingual v2", desc: "Melhor qualidade, 29 idiomas" },
  { id: "eleven_turbo_v2_5", name: "Turbo v2.5", desc: "Baixa latência, alta qualidade" },
  { id: "eleven_turbo_v2", name: "Turbo v2", desc: "Mais rápido, ideal para tempo real" },
  { id: "eleven_monolingual_v1", name: "Monolingual v1", desc: "Apenas inglês, legado" },
];

const OUTPUT_FORMATS = [
  { id: "mp3_44100_128", name: "MP3 44.1kHz 128kbps", desc: "Alta qualidade" },
  { id: "mp3_22050_32", name: "MP3 22kHz 32kbps", desc: "Arquivos menores" },
  { id: "pcm_16000", name: "PCM 16kHz", desc: "Para processamento" },
  { id: "pcm_44100", name: "PCM 44.1kHz", desc: "Alta fidelidade" },
  { id: "ulaw_8000", name: "μ-law 8kHz", desc: "Telefonia" },
];

interface ElevenLabsConfig {
  apiKey: string;
  defaultVoiceId: string;
  defaultModel: string;
  outputFormat: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
  sttEnabled: boolean;
  sfxEnabled: boolean;
}

const DEFAULT_CONFIG: ElevenLabsConfig = {
  apiKey: "",
  defaultVoiceId: "EXAVITQu4vr4xnSDxMaL",
  defaultModel: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  speed: 1.0,
  sttEnabled: true,
  sfxEnabled: true,
};

const ElevenLabsSettings = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<ElevenLabsConfig>(DEFAULT_CONFIG);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [testText, setTestText] = useState("Olá! Este é um teste da integração com ElevenLabs.");
  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState<{ used: number; total: number } | null>(null);

  // Load config
  useEffect(() => {
    if (!user) return;
    supabase
      .from("settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "elevenlabs")
      .single()
      .then(({ data }) => {
        if (data?.value) {
          const v = data.value as any;
          setConfig({ ...DEFAULT_CONFIG, ...v });
          if (v.apiKey) setSaved(true);
        }
        setLoading(false);
      });
  }, [user]);

  const update = useCallback((partial: Partial<ElevenLabsConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const save = async () => {
    if (!user) return;
    if (!config.apiKey.trim()) {
      toast.error("API Key é obrigatória.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { user_id: user.id, key: "elevenlabs", value: config as any },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      setSaved(true);
      toast.success("Configurações ElevenLabs salvas!");
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (!user) return;
    await supabase.from("settings").delete().eq("user_id", user.id).eq("key", "elevenlabs");
    setConfig(DEFAULT_CONFIG);
    setSaved(false);
    setQuotaInfo(null);
    toast.success("Configuração ElevenLabs removida.");
  };

  const verifyKey = async () => {
    if (!config.apiKey.trim()) return;
    setVerifying(true);
    try {
      const resp = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": config.apiKey.trim() },
      });
      if (!resp.ok) {
        toast.error(`API Key inválida (${resp.status}). Verifique e tente novamente.`);
        setVerifying(false);
        return;
      }
      const data = await resp.json();
      setQuotaInfo({
        used: data.character_count || 0,
        total: data.character_limit || 0,
      });
      toast.success(`API Key verificada! Plano: ${data.tier || "Free"}`);
    } catch {
      toast.error("Erro ao verificar a API Key.");
    } finally {
      setVerifying(false);
    }
  };

  const testTTS = async () => {
    if (!testText.trim() || !config.apiKey.trim()) {
      toast.error("Preencha a API Key e o texto de teste.");
      return;
    }
    setPlaying(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-tts", {
        body: {
          text: testText,
          voiceId: config.defaultVoiceId,
          model: config.defaultModel,
          outputFormat: config.outputFormat,
          voiceSettings: {
            stability: config.stability,
            similarity_boost: config.similarityBoost,
            style: config.style,
            use_speaker_boost: config.useSpeakerBoost,
            speed: config.speed,
          },
        },
      });

      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        setPlaying(false);
        return;
      }

      if (data?.audioContent) {
        const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
        const audio = new Audio(audioUrl);
        setAudioEl(audio);
        audio.onended = () => { setPlaying(false); setAudioEl(null); };
        audio.onerror = () => { setPlaying(false); setAudioEl(null); toast.error("Erro ao reproduzir áudio."); };
        await audio.play();
      } else {
        toast.error("Nenhum áudio retornado.");
        setPlaying(false);
      }
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
      setPlaying(false);
    }
  };

  const stopAudio = () => {
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
      setAudioEl(null);
    }
    setPlaying(false);
  };

  const maskKey = (k: string) =>
    k.length > 8 ? k.slice(0, 4) + "••••••••" + k.slice(-4) : "••••••••";

  const selectedVoice = VOICES.find((v) => v.id === config.defaultVoiceId);

  if (loading) return <Loader2 className="h-5 w-5 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      {/* API Key */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AudioLines className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="font-heading">ElevenLabs</CardTitle>
              <CardDescription>Text-to-Speech, Speech-to-Text e efeitos sonoros de alta qualidade</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>API Key *</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="sk_..."
                  value={config.apiKey}
                  onChange={(e) => { update({ apiKey: e.target.value }); setSaved(false); }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={verifyKey} disabled={verifying || !config.apiKey.trim()}>
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !config.apiKey.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </Button>
              {saved && (
                <Button variant="destructive" size="sm" onClick={removeKey}>
                  Remover
                </Button>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configurada: {maskKey(config.apiKey)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Obtenha em{" "}
              <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener" className="underline text-primary">
                elevenlabs.io
              </a>
            </p>
          </div>

          {/* Quota */}
          {quotaInfo && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">Uso de caracteres</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {quotaInfo.used.toLocaleString()} / {quotaInfo.total.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${Math.min((quotaInfo.used / quotaInfo.total) * 100, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {Math.round(((quotaInfo.total - quotaInfo.used) / quotaInfo.total) * 100)}% restante
              </p>
            </div>
          )}

          {/* Capabilities */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { icon: Volume2, label: "Text-to-Speech" },
              { icon: Mic, label: "Speech-to-Text" },
              { icon: FileAudio, label: "Efeitos Sonoros" },
              { icon: Languages, label: "29 Idiomas" },
              { icon: Wand2, label: "Clonagem de Voz" },
            ].map((cap) => (
              <Badge key={cap.label} variant="secondary" className="gap-1 text-xs">
                <cap.icon className="h-3 w-3" />
                {cap.label}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Config Tabs */}
      {saved && (
        <Tabs defaultValue="voice" className="space-y-4">
          <TabsList className="w-full flex overflow-x-auto">
            <TabsTrigger value="voice" className="text-xs">Voz Padrão</TabsTrigger>
            <TabsTrigger value="params" className="text-xs">Parâmetros</TabsTrigger>
            <TabsTrigger value="features" className="text-xs">Funcionalidades</TabsTrigger>
            <TabsTrigger value="test" className="text-xs">Testar</TabsTrigger>
          </TabsList>

          {/* Voice Selection */}
          <TabsContent value="voice">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-heading">Seleção de Voz</CardTitle>
                <CardDescription>Escolha a voz padrão para Text-to-Speech</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Voz</Label>
                  <Select value={config.defaultVoiceId} onValueChange={(v) => update({ defaultVoiceId: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {VOICES.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{v.name}</span>
                            <span className="text-xs text-muted-foreground">{v.tags.join(", ")}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Voice grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {VOICES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => update({ defaultVoiceId: v.id })}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        config.defaultVoiceId === v.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <p className="text-sm font-medium">{v.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {v.tags.map((t) => (
                          <span key={t} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  Explore mais vozes na{" "}
                  <a href="https://elevenlabs.io/voice-library" target="_blank" rel="noopener" className="underline text-primary">
                    Voice Library
                  </a>
                </p>

                <div className="space-y-2">
                  <Label className="text-xs">Modelo TTS</Label>
                  <Select value={config.defaultModel} onValueChange={(v) => update({ defaultModel: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TTS_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-muted-foreground">{m.desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Formato de Saída</Label>
                  <Select value={config.outputFormat} onValueChange={(v) => update({ outputFormat: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTPUT_FORMATS.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{f.name}</span>
                            <span className="text-xs text-muted-foreground">{f.desc}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={save} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar Configurações
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Voice Parameters */}
          <TabsContent value="params">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-heading">Parâmetros de Voz</CardTitle>
                <CardDescription>Ajuste fino da qualidade e estilo da voz</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Stability */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Estabilidade</Label>
                    <span className="text-xs font-mono text-muted-foreground">{Math.round(config.stability * 100)}%</span>
                  </div>
                  <Slider min={0} max={1} step={0.05} value={[config.stability]} onValueChange={([v]) => update({ stability: v })} />
                  <p className="text-[10px] text-muted-foreground">
                    Menor = mais expressivo e variável · Maior = mais consistente
                  </p>
                </div>

                {/* Similarity Boost */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Similaridade</Label>
                    <span className="text-xs font-mono text-muted-foreground">{Math.round(config.similarityBoost * 100)}%</span>
                  </div>
                  <Slider min={0} max={1} step={0.05} value={[config.similarityBoost]} onValueChange={([v]) => update({ similarityBoost: v })} />
                  <p className="text-[10px] text-muted-foreground">
                    Quanto se aproximar das características originais da voz
                  </p>
                </div>

                {/* Style */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Estilo</Label>
                    <span className="text-xs font-mono text-muted-foreground">{Math.round(config.style * 100)}%</span>
                  </div>
                  <Slider min={0} max={1} step={0.05} value={[config.style]} onValueChange={([v]) => update({ style: v })} />
                  <p className="text-[10px] text-muted-foreground">
                    Exagero de estilo (apenas Multilingual v2+)
                  </p>
                </div>

                {/* Speed */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Velocidade</Label>
                    <span className="text-xs font-mono text-muted-foreground">{config.speed.toFixed(1)}x</span>
                  </div>
                  <Slider min={0.7} max={1.2} step={0.05} value={[config.speed]} onValueChange={([v]) => update({ speed: v })} />
                </div>

                {/* Speaker Boost */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Speaker Boost</Label>
                    <p className="text-[10px] text-muted-foreground">Melhora clareza e fidelidade da voz</p>
                  </div>
                  <Switch checked={config.useSpeakerBoost} onCheckedChange={(v) => update({ useSpeakerBoost: v })} />
                </div>

                {/* Presets */}
                <div className="space-y-2">
                  <Label className="text-xs">Presets</Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Narração", stability: 0.6, similarityBoost: 0.75, style: 0.1, speed: 0.9 },
                      { label: "Conversacional", stability: 0.4, similarityBoost: 0.6, style: 0.4, speed: 1.0 },
                      { label: "Anúncio", stability: 0.9, similarityBoost: 0.8, style: 0.2, speed: 1.0 },
                      { label: "Personagem", stability: 0.25, similarityBoost: 0.5, style: 0.7, speed: 1.0 },
                    ].map((p) => (
                      <Button
                        key={p.label}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => update({
                          stability: p.stability,
                          similarityBoost: p.similarityBoost,
                          style: p.style,
                          speed: p.speed,
                        })}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <Button onClick={save} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar Parâmetros
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Features */}
          <TabsContent value="features">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-heading">Funcionalidades</CardTitle>
                <CardDescription>Habilite ou desabilite recursos do ElevenLabs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <Volume2 className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Text-to-Speech (TTS)</p>
                      <p className="text-xs text-muted-foreground">Converter texto em áudio com vozes naturais</p>
                    </div>
                  </div>
                  <Badge variant="secondary">Sempre ativo</Badge>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <Mic className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Speech-to-Text (STT)</p>
                      <p className="text-xs text-muted-foreground">Transcrever áudio em texto com diarização</p>
                    </div>
                  </div>
                  <Switch checked={config.sttEnabled} onCheckedChange={(v) => update({ sttEnabled: v })} />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <FileAudio className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Sound Effects (SFX)</p>
                      <p className="text-xs text-muted-foreground">Gerar efeitos sonoros a partir de descrições</p>
                    </div>
                  </div>
                  <Switch checked={config.sfxEnabled} onCheckedChange={(v) => update({ sfxEnabled: v })} />
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" /> Idiomas suportados
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {["Português", "Inglês", "Espanhol", "Francês", "Alemão", "Italiano", "Japonês", "Coreano", "Chinês", "Hindi", "Árabe", "Russo", "+17 outros"].map((l) => (
                      <span key={l} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary font-medium">
                        {l}
                      </span>
                    ))}
                  </div>
                </div>

                <Button onClick={save} disabled={saving} className="w-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar Funcionalidades
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Test */}
          <TabsContent value="test">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-heading">Testar Text-to-Speech</CardTitle>
                <CardDescription>
                  Ouça como a voz {selectedVoice?.name || "selecionada"} soa com suas configurações
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Texto de teste</Label>
                  <Textarea
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="Digite o texto que deseja ouvir..."
                    rows={3}
                    maxLength={500}
                  />
                  <p className="text-[10px] text-muted-foreground text-right">{testText.length}/500 caracteres</p>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Voz:</span> <span className="font-medium">{selectedVoice?.name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Modelo:</span> <span className="font-medium">{TTS_MODELS.find((m) => m.id === config.defaultModel)?.name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Formato:</span> <span className="font-medium">{config.outputFormat}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Velocidade:</span> <span className="font-medium">{config.speed.toFixed(1)}x</span></div>
                </div>

                <div className="flex gap-2">
                  {playing ? (
                    <Button variant="destructive" onClick={stopAudio} className="flex-1">
                      <Square className="mr-2 h-4 w-4" /> Parar
                    </Button>
                  ) : (
                    <Button onClick={testTTS} disabled={!testText.trim()} className="flex-1">
                      <Play className="mr-2 h-4 w-4" /> Reproduzir
                    </Button>
                  )}
                </div>

                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  ⚠️ Cada teste consome caracteres da sua cota ElevenLabs.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default ElevenLabsSettings;
