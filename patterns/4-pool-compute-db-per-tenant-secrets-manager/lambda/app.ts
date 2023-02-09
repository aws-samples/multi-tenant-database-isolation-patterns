import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand, ListSecretsCommand } from '@aws-sdk/client-secrets-manager';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

const stsClient = new STSClient({});
export interface GetWidgetEvent {
    tenant: string;
}

export const lambdaHandler = async (event: GetWidgetEvent) => {
    const stsParams = {
        RoleArn: process.env.role_arn,
        RoleSessionName: event.tenant,
        DurationSeconds: 900,
        Tags: [
            {
                Key: 'tenant',
                Value: event.tenant,
            },
        ],
    };
    const tempCreds = await stsClient.send(new AssumeRoleCommand(stsParams));

    const listSecretsParams = {
        Filters: [
            { Key: 'tag-key', Values: ['tenant'] },
            { Key: 'tag-value', Values: [event.tenant] },
        ],
    };
    const secretsmanager = new SecretsManagerClient({
        credentials: {
            accessKeyId: tempCreds.Credentials!.AccessKeyId!,
            secretAccessKey: tempCreds.Credentials!.SecretAccessKey!,
            sessionToken: tempCreds.Credentials!.SessionToken!,
        },
    });

    const listSecretCmd = new ListSecretsCommand(listSecretsParams);
    const secrets = await secretsmanager.send(listSecretCmd);

    const getSecretParams = {
        SecretId: secrets.SecretList![0].ARN,
    };
    const getSecretCmd = new GetSecretValueCommand(getSecretParams);
    const secret = await secretsmanager.send(getSecretCmd);

    const pool = new Pool({
        user: event.tenant + '_login',
        host: process.env.server!,
        database: event.tenant,
        password: JSON.parse(secret.SecretString!).password,
        port: parseInt(process.env.port!),
    });

    const results = await pool!.query('SELECT id, value FROM widget;');
    await pool.end();

    return {
        statusCode: 200,
        body: JSON.stringify({
            results,
        }),
    };
};
