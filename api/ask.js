// Serverless function (Vercel) — recebe a pergunta do Analista Orbi no navegador,
// chama a API da Anthropic com a chave guardada no servidor (nunca exposta no
// código do site) e devolve a resposta já convertida pra HTML formatado.
//
// Precisa da variável de ambiente ANTHROPIC_API_KEY configurada no projeto
// Vercel (Project Settings → Environment Variables).

// Converte o markdown padrão que o modelo escreve (# título, **negrito**,
// listas com - ou 1.) em HTML de verdade, usando classes estilizadas no app
// (ai-h = título, ai-p = parágrafo espaçado, ai-ul/ai-ol = listas com marcador).
function markdownParaHtmlRico(txt) {
  var lines = txt.replace(/\r\n/g, '\n').split('\n');
  var html = '';
  var listType = null; // 'ul' | 'ol'

  function fecharLista() {
    if (listType) { html += '</' + listType + '>'; listType = null; }
  }
  function inline(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  lines.forEach(function (raw) {
    var line = raw.trim();
    if (!line) { fecharLista(); return; }

    var h = line.match(/^#{1,6}\s*(.+)$/);
    if (h) { fecharLista(); html += '<span class="ai-h">' + inline(h[1]) + '</span>'; return; }

    var ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (listType !== 'ul') { fecharLista(); html += '<ul class="ai-ul">'; listType = 'ul'; }
      html += '<li>' + inline(ul[1]) + '</li>';
      return;
    }

    var ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ol) {
      if (listType !== 'ol') { fecharLista(); html += '<ol class="ai-ol">'; listType = 'ol'; }
      html += '<li>' + inline(ol[1]) + '</li>';
      return;
    }

    fecharLista();
    html += '<p class="ai-p">' + inline(line) + '</p>';
  });
  fecharLista();
  return html;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada no servidor.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const question = (body && body.question || '').toString().trim();
  const context = (body && body.context || '').toString();

  if (!question) {
    res.status(400).json({ error: 'Pergunta vazia.' });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: 'Pergunta muito longa.' });
    return;
  }

  const systemPrompt =
    'Você é o "Analista Orbi", assistente financeiro dentro do app Orbi369 (gestão financeira de negócio/pessoal/investimentos). ' +
    'Responda em português brasileiro, de forma direta, objetiva e curta — vá direto ao ponto, sem enrolação nem repetir a pergunta. ' +
    'Use os dados financeiros reais do usuário abaixo quando forem relevantes pra pergunta. ' +
    'Se a pergunta for sobre educação financeira geral (ex: diferença entre CDB e FII), responda normalmente com seu conhecimento, ' +
    'sem inventar números específicos do usuário que não estejam no contexto.\n\n' +
    'Tamanho: prefira respostas curtas. Só use título ou lista quando o conteúdo realmente tiver várias partes distintas — ' +
    'a maioria das perguntas merece só 1-3 parágrafos curtos, direto ao ponto.\n\n' +
    'Formatação: markdown simples — ## para título curto só se organizar melhor, **negrito** nos pontos-chave, ' +
    'listas com "- " ou "1. " só quando fizer sentido estrutural.\n\n' +
    'Final: termine SEMPRE com uma frase curta oferecendo continuar ajudando ou perguntando se ficou claro ' +
    '(ex: "Ficou claro?", "Quer que eu detalhe algum ponto?", "Faz sentido pro seu caso?"). Varie a frase, não repita sempre a mesma.\n\n' +
    'Contexto financeiro atual do usuário:\n' + (context || 'Não disponível.');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 450,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });

    const data = await r.json();

    if (!r.ok) {
      res.status(r.status).json({ error: (data && data.error && data.error.message) || 'Erro na API da Anthropic.' });
      return;
    }

    const answer = (data.content || []).map(function (c) { return c.text || ''; }).join('').trim();
    const answerHtml = markdownParaHtmlRico(answer);
    res.status(200).json({ answer: answerHtml || 'Não consegui gerar uma resposta agora, tenta de novo.' });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao chamar a IA: ' + err.message });
  }
};
