function isDandaToken(word) {
  return /[\u0964\u0965]/.test(word);
}

function isRahaoToken(word) {
  const bare = String(word || '').replace(/[\u0964\u0965]/g, '').trim();
  return (
    bare === '\u0A30\u0A39\u0A3E\u0A09' ||
    bare === '\u0A30\u0A39\u0A3E\u0A09\u0A67' ||
    bare === '\u0A30\u0A39\u0A3E\u0A09\u0A68' ||
    bare === '\u0A30\u0A39\u0A3E\u0A09\u0A26\u0A42\u0A1C\u0A3E'
  );
}

export default function renderGurmukhiLine(text, vishraams, larivaar = false) {
  if (!text) return null;

  const visMap = new Map();
  if (Array.isArray(vishraams)) {
    for (const item of vishraams) {
      if (item && Number.isInteger(item.p)) {
        visMap.set(item.p, item.t === 'y' ? 'y' : 'v');
      }
    }
  }

  const tokens = String(text).split(/(\s+)/);
  let wordCount = 0;

  return tokens.map((token, index) => {
    if (!token) return null;
    if (!token.trim()) {
      // Larivaar collapses inter-word whitespace.
      return larivaar ? null : token;
    }

    let className = 'shabad-word';
    if (isRahaoToken(token)) {
      className += ' shabad-word-rahao';
    } else if (isDandaToken(token)) {
      className += ' shabad-word-marker';
    } else {
      const pauseType = visMap.get(wordCount);
      if (pauseType === 'v') className += ' shabad-word-pause';
      else if (pauseType === 'y') className += ' shabad-word-yamki';
      wordCount += 1;
    }

    return <span key={index} className={className}>{token}</span>;
  });
}
