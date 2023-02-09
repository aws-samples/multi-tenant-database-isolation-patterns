import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
const secretsmanager = new SecretsManagerClient({});

export interface GetWidgetEvent {
    tenantId: string;
}

const init = async () => {
    const getSecretParams = {
        SecretId: process.env.secret,
    };
    const getSecretCmd = new GetSecretValueCommand(getSecretParams);
    const secret = await secretsmanager.send(getSecretCmd);

    //create connection pool using pooled password
    if (!pool) {
        pool = new Pool({
            user: process.env.username,
            host: process.env.server!,
            database: process.env.db,
            password: JSON.parse(secret.SecretString!).password,
            port: parseInt(process.env.port!),
        });
    }

    return;
};

// initialize the connection pool outside the handler to allow for connection reuse
const token = init();
let pool: Pool | null = null;

export const lambdaHandler = async (event: GetWidgetEvent) => {
    await token;
    await pool!.query("SET SESSION app.current_tenant = '" + event.tenantId + "'");
    const results = await pool!.query('SELECT id, value FROM widget;');

    return {
        statusCode: 200,
        body: JSON.stringify({
            results,
        }),
    };
};
