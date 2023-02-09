import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
const secretsmanager = new SecretsManagerClient({});
export interface GetWidgetEvent {}

const init = async () => {
    //get secret from secrets manager
    const params = {
        SecretId: process.env.secret_arn,
    };
    const cmd = new GetSecretValueCommand(params);
    const secret = await secretsmanager.send(cmd);

    //create connection pool using secrets manager credentials
    if (!pool) {
        pool = new Pool({
            user: process.env.user!,
            host: process.env.server!,
            database: process.env.db!,
            password: JSON.parse(secret.SecretString!).password,
            port: parseInt(process.env.port!),
        });
    }

    return secret;
};

// initialize the connection pool outside the handler to allow for connection reuse
const secret = init();
let pool: Pool | null = null;

export const lambdaHandler = async (event: GetWidgetEvent) => {
    await secret;
    const results = await pool!.query('SELECT id, value FROM widget;');

    return {
        statusCode: 200,
        body: JSON.stringify({
            results,
        }),
    };
};
