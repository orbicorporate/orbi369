// Serverless function (Vercel) — recebe a pergunta do Analista Orbi no navegador,
// chama a API da Anthropic com a chave guardada no servidor (nunca exposta no
// código do site) e devolve a resposta em texto simples.
//
// Precisa da variável de ambiente ANTHROPIC_API_KEY configurada no projeto
// Vercel (Project Settings → Environment Variables).

// Rede de segurança: mesmo com a instrução no prompt, o modelo às vezes ainda
// escreve **negrito** ou # título em markdown. Converte pro que a bolha do
// chat sabe exibir, ao invés de mostrar os símbolos crus.
function markdownParaHtmlSimples(txt) {
  return txt
    .replace(/^#{1,6}\s*(.+)$/gm, '<strong>$1</strong>')      // # Título -> <strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')          // **negrito** -> <strong>
    .replace(/^[-*]\s+/gm, '• ')                                // - item / * item -> • item
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>');
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
    'Responda em português brasileiro, de forma direta, prática e curta (poucos parágrafos, sem enrolação). ' +
    'Use os dados financeiros reais do usuário abaixo quando forem relevantes pra pergunta. ' +
    'Se a pergunta for sobre educação financeira geral (ex: diferença entre CDB e FII), responda normalmente com seu conhecimento, ' +
    'sem inventar números específicos do usuário que não estejam no contexto.\n\n' +
    'IMPORTANTE — formatação: esta resposta é inserida direto como HTML numa bolha de chat, então NUNCA use markdown ' +
    '(nada de **negrito**, # títulos, listas com - ou *, ou blocos de código). Escreva em texto corrido, com quebras de linha ' +
    'simples (<br>) entre ideias quando fizer sentido. Se quiser destacar algo, use <strong>texto</strong> (tag HTML real), nunca asteriscos.\n\n' +
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
        max_tokens: 600,
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
    const answerLimpo = markdownParaHtmlSimples(answer);
    res.status(200).json({ answer: answerLimpo || 'Não consegui gerar uma resposta agora, tenta de novo.' });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao chamar a IA: ' + err.message });
  }
};
