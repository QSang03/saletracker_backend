// Helper utility to debug token issues
// Chạy trong backend console hoặc debug

function compareTokensDetailed(token1, token2, label1 = 'Token 1', label2 = 'Token 2') {
  console.log(`\n🔍 Comparing ${label1} vs ${label2}:`);
  
  // Basic comparison
  console.log(`${label1} length:`, token1.length);
  console.log(`${label2} length:`, token2.length);
  console.log('Exact match:', token1 === token2);
  
  // Trimmed comparison
  const trim1 = token1.trim();
  const trim2 = token2.trim();
  console.log('Trimmed match:', trim1 === trim2);
  
  if (trim1 === trim2) {
    console.log('✅ Tokens match after trimming');
    return true;
  }
  
  // Character analysis
  console.log('\n📊 Character Analysis:');
  console.log(`${label1} first 50:`, token1.substring(0, 50));
  console.log(`${label2} first 50:`, token2.substring(0, 50));
  console.log(`${label1} last 50:`, token1.substring(-50));
  console.log(`${label2} last 50:`, token2.substring(-50));
  
  // Find first difference
  const maxLen = Math.max(token1.length, token2.length);
  for (let i = 0; i < maxLen; i++) {
    const char1 = token1[i] || '<END>';
    const char2 = token2[i] || '<END>';
    const code1 = token1.charCodeAt(i) || 0;
    const code2 = token2.charCodeAt(i) || 0;
    
    if (char1 !== char2) {
      console.log(`❌ First difference at position ${i}:`);
      console.log(`  ${label1}: '${char1}' (charCode: ${code1})`);
      console.log(`  ${label2}: '${char2}' (charCode: ${code2})`);
      
      // Show surrounding context
      const start = Math.max(0, i - 5);
      const end = Math.min(maxLen, i + 5);
      console.log(`  Context ${label1}: "${token1.substring(start, end)}"`);
      console.log(`  Context ${label2}: "${token2.substring(start, end)}"`);
      break;
    }
  }
  
  // Check for invisible characters
  const invisibleChars1 = token1.match(/[\s\t\n\r\u00A0\u2000-\u200B\u2028-\u2029\u3000]/g);
  const invisibleChars2 = token2.match(/[\s\t\n\r\u00A0\u2000-\u200B\u2028-\u2029\u3000]/g);
  
  if (invisibleChars1 || invisibleChars2) {
    console.log('\n👻 Invisible Characters Found:');
    console.log(`${label1} invisible chars:`, invisibleChars1?.length || 0);
    console.log(`${label2} invisible chars:`, invisibleChars2?.length || 0);
  }
  
  return false;
}

// Test encoding/decoding
function testTokenEncoding(token) {
  console.log('\n🔧 Token Encoding Test:');
  console.log('Original:', token.substring(0, 50));
  
  const encoded = encodeURIComponent(token);
  console.log('Encoded:', encoded.substring(0, 50));
  
  const decoded = decodeURIComponent(encoded);
  console.log('Decoded:', decoded.substring(0, 50));
  
  console.log('Encoding roundtrip match:', token === decoded);
  
  return decoded;
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { compareTokensDetailed, testTokenEncoding };
}

// For browser console
if (typeof window !== 'undefined') {
  window.compareTokensDetailed = compareTokensDetailed;
  window.testTokenEncoding = testTokenEncoding;
}
