import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const TABLE = process.env.TABLE || 'prepice';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }), { marshallOptions: { removeUndefinedValues: true } });
export const get = async (pk, sk = 'META') => (await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))).Item?.data ?? null;
export const put = (pk, sk, data) => ddb.send(new PutCommand({ TableName: TABLE, Item: { pk, sk, data, ts: Date.now() } }));
export const list = async (pk, { limit = 50, newest = true } = {}) => (await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': pk }, ScanIndexForward: !newest, Limit: limit }))).Items.map((i) => i.data);
// daily spend guard for Bedrock and PayPal calls made by anonymous visitors
export async function bump(kind, limit) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const r = await ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: `BUDGET#${kind}`, sk: day }, UpdateExpression: 'ADD n :one SET expires = :e', ConditionExpression: 'attribute_not_exists(n) OR n < :lim', ExpressionAttributeValues: { ':one': 1, ':lim': limit, ':e': Math.floor(Date.now() / 1000) + 172800 }, ReturnValues: 'UPDATED_NEW' }));
    return r.Attributes.n;
  } catch (e) { if (e.name === 'ConditionalCheckFailedException') return null; throw e; }
}
export async function peek(kind) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `BUDGET#${kind}`, sk: day } }));
  return r.Item?.n || 0;
}
