// src/main/redaction-config.ts
// ────────────────────────────────────────────────────────────────
// Centralized redaction configuration using redactum with selective policies
// ────────────────────────────────────────────────────────────────

import { redactum, PolicyCategory, Policy, RedactumOptions } from 'redactum';

// ── Exact string replacements – highest priority, exact match only ──
// (keep this for known/company-specific or test values)
export const EXACT_REPLACEMENTS: Record<string, string> = {
    'mycompany': '[COMPANY_NAME]',
};

// ── Define which built-in policy names to include ──
// Using string literals that match the actual policy names in redactum
// This selective approach prevents redaction of normal code identifiers
export const INCLUDED_POLICY_NAMES: string[] = [
    'API Key',
    'AWS Access Key',
    'AWS Secret Key',
    'Azure Storage Account Key',
    'Azure Container Registry Key',
    'Azure CosmosDB Key',
    'Azure Service Bus Connection String',
    'Azure Event Hub Connection String',
    'Azure IoT Hub Connection String',
    'Azure SignalR Connection String',
    'Azure Redis Cache Connection String',
    'Azure SQL Connection String',
    'Google Cloud API Key',
    'Google OAuth Client Secret',
    'Google Service Account Private Key',
    'Credit Card Number',
    'Email Address',
    'IPv4 Address',
    'IPv6 Address',
    'MAC Address',
    'Password',
    'Private Key',
    'Slack Token',
    'Stripe API Key',
    'Stripe Restricted API Key',
    'Telephone Number',
    'URL Password',
    'Username',
    'UUID', // Explicitly include UUID to ensure it's redacted
];

// ── Optional custom patterns (only for specific needs) ──
export const CUSTOM_PATTERNS: Policy[] = [
    {
        name: 'Subscription_ID',
        pattern: /\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        category: PolicyCategory.CUSTOM,
    },
    {
        name: 'Resource_Group',
        pattern: /resourceGroups\/[a-zA-Z0-9_-]+/gi,
        category: PolicyCategory.CUSTOM,
    },
    {
        name: 'Digital_Identity',
        pattern: /\[DIGITAL_IDENTITY\]/gi,
        category: PolicyCategory.CUSTOM,
    },
    {
        name: 'Generic_GUID',
        pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        category: PolicyCategory.CUSTOM,
    },
    // Add more only if needed (e.g. internal IDs, company-specific patterns)
];

// ── Simple dynamic placeholder logic ──
export function getPlaceholderForCategory(category: string): string {
    if (category === 'Subscription_ID') return '[SUBSCRIPTION_ID]';
    if (category === 'Resource_Group') return '[RESOURCE_GROUP]';
    if (category === 'Digital_Identity') return '[DIGITAL_IDENTITY]';
    if (category === 'Generic_GUID' || category === 'UUID') return '[UUID]';
    if (category.includes('KEY') || category.includes('TOKEN') || category.includes('Secret')) return '[SECRET]';
    if (category.includes('PASSWORD') || category.includes('Password')) return '[PASSWORD]';
    if (category.includes('CREDENTIAL') || category.includes('Credential')) return '[CREDENTIAL]';
    if (category.includes('ADDRESS') || category.includes('Address')) return '[ADDRESS]';
    if (category.includes('PHONE') || category.includes('Telephone')) return '[PHONE]';
    if (category.includes('Credit Card')) return '[CREDIT_CARD]';
    if (category.includes('Email')) return '[EMAIL]';
    if (category.includes('IPv4') || category.includes('IPv6')) return '[IP_ADDRESS]';
    return `[${category.toUpperCase().replace(/\s+/g, '_')}]`; // fallback – clear and informative
}

// ── Main redaction function – uses selective policies ──
export function redactContent(text: string): string {
    // Step 1: Apply exact string replacements first (precise & fast)
    let result = text;
    for (const [secret, placeholder] of Object.entries(EXACT_REPLACEMENTS)) {
        if (!secret.trim()) continue;
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), placeholder);
    }

    // Step 2: Apply redactum with selective built-in policies
    const options: RedactumOptions = {
        policies: INCLUDED_POLICY_NAMES,
        customPolicies: CUSTOM_PATTERNS.length > 0 ? CUSTOM_PATTERNS : undefined,
        replacement: (match: string, category: string) =>
            getPlaceholderForCategory(category),
    };

    const resultAfterRedactum = redactum(result, options);

    return resultAfterRedactum.redactedText;
}