import { Pool } from 'pg';
import { Signer } from '@aws-sdk/rds-signer';
import fs from 'fs';
import https from 'https';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

const stsClient = new STSClient({});

export interface GetWidgetEvent {
    tenant: string;
}

const init = async () => {
    //download the ca cert for SSL connection to RDS
    const file = new Promise((resolve, reject) => {
        https.get(process.env.ca!, (res: any) => {
            const file = fs.createWriteStream(process.env.ca_path!);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`File downloaded!`);
                resolve(res);
            });
        });
    });
    await file;
};

const cert = init();

export const lambdaHandler = async (event: GetWidgetEvent) => {
    await cert;

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

    const signer = new Signer({
        credentials: {
            accessKeyId: tempCreds.Credentials!.AccessKeyId!,
            secretAccessKey: tempCreds.Credentials!.SecretAccessKey!,
            sessionToken: tempCreds.Credentials!.SessionToken!,
        },
        hostname: process.env.server!,
        port: parseInt(process.env.port!),
        username: event.tenant,
    });

    //generate a temporary access token using the execution role
    const token = await signer.getAuthToken();

    //create connection pool using temporary access token for IAM authentication
    const pool = new Pool({
        user: event.tenant,
        host: process.env.server!,
        database: event.tenant,
        password: token,
        ssl: {
            rejectUnauthorized: false,
            ca: fs.readFileSync(process.env.ca_path!).toString(),
        },
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
