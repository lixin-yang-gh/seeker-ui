/**
 * Sanitization utility for text content
 * Only decodes HTML entities and Unicode encoded strings
 * No other string replacement, no trimming
 */

/**
 * Converts HTML entities back to their original characters
 * Only handles HTML special character codes and Unicode encoded strings
 */
export function decodeHtmlEntities(text: string): string {
    if (!text || typeof text !== 'string') return text;

    const entityMap: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&#34;': '"',
        '&#60;': '<',
        '&#62;': '>',
        '&#38;': '&',
        '&#x26;': '&',
        '&#x3C;': '<',
        '&#x3c;': '<',
        '&#x3E;': '>',
        '&#x3e;': '>',
        '&#x22;': '"',
        '&#x27;': "'",
        '&nbsp;': ' ',
        '&#160;': ' ',
        '&#xA0;': ' ',
    };

    // First pass: Replace named entities
    let result = text;
    for (const [entity, replacement] of Object.entries(entityMap)) {
        result = result.replace(new RegExp(entity, 'g'), replacement);
    }

    // Second pass: Replace numeric entities (decimal: &#123;)
    result = result.replace(/&#(\d+);/g, (match, dec) =>
        String.fromCharCode(parseInt(dec, 10))
    );

    // Third pass: Replace hex entities (hex: &#x1F4A9;)
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    );

    return result;
}

/**
 * Simple sanitization that only decodes HTML entities
 * No other string replacement, no trimming
 */
export function sanitizeText(text: string): string {
    if (!text || typeof text !== 'string') return text;
    
    // Only decode HTML entities
    return decodeHtmlEntities(text);
}