// Registers the deployed Function URL as a PayPal sandbox webhook and stores its id for signature verification.
import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import * as P from '../lambda/paypal.mjs';
const api = JSON.parse(readFileSync(new URL('../.deploy-state.json', import.meta.url))).api;
const url = `${api}/api/webhooks/paypal`;
const types = ['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.CANCELLED', 'INVOICING.INVOICE.REFUNDED', 'INVOICING.INVOICE.UPDATED', 'BILLING.SUBSCRIPTION.CREATED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED'];
const existing = (await P.listWebhooks()).json.webhooks || [];
for (const w of existing.filter((w) => w.url === url)) await P.pp('DELETE', `/v1/notifications/webhooks/${w.id}`);
const wh = (await P.createWebhook(url, types)).json;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
await ddb.send(new PutCommand({ TableName: 'prepice', Item: { pk: 'CONFIG#webhook', sk: 'META', data: { id: wh.id, url, types } } }));
console.log('webhook', wh.id, url, wh.event_types.map((e) => e.name).join(', '));
