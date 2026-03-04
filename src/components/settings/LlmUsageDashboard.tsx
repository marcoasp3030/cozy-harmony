import { useState } from "react";
import { Brain, Sparkles, Loader2, RefreshCw, DollarSign, Zap, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OpenAIData {
  configured: boolean;
  note?: string;
  costs?: { period: string; total_usd: string; source: string };
  credits?: { total_granted: number; total_used: number; total_available: number };
  subscription?: { plan: string; hard_limit_usd: number; soft_limit_usd: number };
  usage?: { input_tokens: number; output_tokens: number; num_requests: number };
}

interface GeminiData {
  configured: boolean;
  note?: string;
  available_models?: number;
  status?: string;
}

const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};

const LlmUsageDashboard = () => {
  const [loading, setLoading] = useState(false);
  const [openai, setOpenai] = useState<OpenAIData | null>(null);
  const [gemini, setGemini] = useState<GeminiData | null>(null);
  const [fetched, setFetched] = useState(false);

  const fetchUsage = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("llm-usage");
      if (error) throw error;
      setOpenai(data?.openai || null);
      setGemini(data?.gemini || null);
      setFetched(true);
    } catch (err: any) {
      toast.error("Erro ao buscar dados de consumo: " + (err.message || "Tente novamente"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="font-heading">Consumo & Saldo</CardTitle>
              <CardDescription>Monitore o uso de tokens e créditos das suas APIs</CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsage}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            {fetched ? "Atualizar" : "Consultar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!fetched && !loading && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <DollarSign className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Clique em "Consultar" para verificar o consumo e saldo das suas APIs</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Consultando APIs de billing...</span>
          </div>
        )}

        {fetched && !loading && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* OpenAI Card */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm">OpenAI</h3>
                {openai?.configured ? (
                  <span className="ml-auto text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">Ativa</span>
                ) : (
                  <span className="ml-auto text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Não configurada</span>
                )}
              </div>

              {openai?.configured ? (
                <div className="space-y-3">
                  {/* Credits / Balance */}
                  {openai.credits && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Créditos disponíveis</span>
                        <span className="font-semibold text-success">
                          ${openai.credits.total_available?.toFixed(2)}
                        </span>
                      </div>
                      <Progress
                        value={
                          openai.credits.total_granted > 0
                            ? (openai.credits.total_available / openai.credits.total_granted) * 100
                            : 0
                        }
                        className="h-2"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Usado: ${openai.credits.total_used?.toFixed(2)}</span>
                        <span>Total: ${openai.credits.total_granted?.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {/* Subscription Info */}
                  {openai.subscription && (
                    <div className="rounded-md bg-muted/50 p-2.5 space-y-1">
                      <p className="text-xs font-medium">Plano: {openai.subscription.plan}</p>
                      {openai.subscription.hard_limit_usd && (
                        <p className="text-xs text-muted-foreground">
                          Limite: ${openai.subscription.hard_limit_usd?.toFixed(2)}/mês
                        </p>
                      )}
                    </div>
                  )}

                  {/* Costs this month */}
                  {openai.costs && (
                    <div className="rounded-md bg-muted/50 p-2.5 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Gasto este mês</span>
                        <span className="text-sm font-bold text-primary">${openai.costs.total_usd}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{openai.costs.period}</p>
                    </div>
                  )}

                  {/* Usage tokens */}
                  {openai.usage && (
                    <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium">Uso este mês</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center">
                          <p className="text-lg font-bold text-foreground">{formatTokens(openai.usage.input_tokens)}</p>
                          <p className="text-xs text-muted-foreground">Input</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-foreground">{formatTokens(openai.usage.output_tokens)}</p>
                          <p className="text-xs text-muted-foreground">Output</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-foreground">{openai.usage.num_requests}</p>
                          <p className="text-xs text-muted-foreground">Requests</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Note / fallback message */}
                  {openai.note && !openai.costs && !openai.credits && !openai.usage && (
                    <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5">
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                      <p className="text-xs text-warning">{openai.note}</p>
                    </div>
                  )}

                  <a
                    href="https://platform.openai.com/settings/organization/billing/overview"
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Ver detalhes no painel OpenAI <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Configure a API Key acima para ver o consumo.</p>
              )}
            </div>

            {/* Gemini Card */}
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm">Google Gemini</h3>
                {gemini?.configured ? (
                  gemini.status === "rate_limited" ? (
                    <span className="ml-auto text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full">Cota esgotada</span>
                  ) : (
                    <span className="ml-auto text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">Ativa</span>
                  )
                ) : (
                  <span className="ml-auto text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Não configurada</span>
                )}
              </div>

              {gemini?.configured ? (
                <div className="space-y-3">
                  {gemini.status === "active" && (
                    <div className="rounded-md bg-success/10 p-2.5">
                      <p className="text-xs text-success font-medium">✅ API funcional</p>
                      {gemini.available_models && (
                        <p className="text-xs text-success/80 mt-1">{gemini.available_models} modelos Gemini disponíveis</p>
                      )}
                    </div>
                  )}

                  {gemini.status === "rate_limited" && (
                    <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5">
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                      <p className="text-xs text-warning">Cota esgotada! Aguarde o reset ou faça upgrade.</p>
                    </div>
                  )}

                  <div className="rounded-md bg-muted/50 p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-medium">Plano gratuito (AI Studio)</span>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>• Gemini 2.5 Flash: 500 req/dia</p>
                      <p>• Gemini 2.5 Pro: 25 req/dia</p>
                      <p>• Gemini 2.0 Flash: 1.500 req/dia</p>
                    </div>
                  </div>

                  {gemini.note && (
                    <p className="text-xs text-muted-foreground">{gemini.note}</p>
                  )}

                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Ver detalhes no Google AI Studio <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Configure a API Key acima para ver o consumo.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LlmUsageDashboard;
