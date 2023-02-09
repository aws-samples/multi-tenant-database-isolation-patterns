import { Pool } from 'pg';
import { Signer } from '@aws-sdk/rds-signer';
import fs from 'fs';
import https from 'https';

export interface GetWidgetEvent {}

const signer = new Signer({
    hostname: process.env.server!,
    port: parseInt(process.env.port!),
    username: process.env.user!,
});

const init = async (toSign: Signer) => {
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
    //generate a temporary access token using the execution role
    const token = await toSign.getAuthToken();

    //create connection pool using temporary access token for IAM authentication
    if (!pool) {
        pool = new Pool({
            user: process.env.user!,
            host: process.env.server!,
            database: process.env.database!,
            password: token,
            ssl: {
                rejectUnauthorized: false,
                ca: fs.readFileSync(process.env.ca_path!).toString(),
            },
            port: parseInt(process.env.port!),
        });
    }

    return token;
};

// initialize the connection pool outside the handler to allow for connection reuse
const token = init(signer);
let pool: Pool | null = null;

export const lambdaHandler = async (event: GetWidgetEvent) => {
    await token;
    const results = await pool!.query('SELECT id, value FROM widget;');

    return {
        statusCode: 200,
        body: JSON.stringify({
            results,
        }),
    };
};
