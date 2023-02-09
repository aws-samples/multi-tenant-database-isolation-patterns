import { Client } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
const secretsmanager = new SecretsManagerClient({});
export interface DataGenerationEvent {}

export const lambdaHandler = async (event: DataGenerationEvent) => {
    const adminParams = {
        SecretId: process.env.adminSecret,
    };
    const adminCmd = new GetSecretValueCommand(adminParams);
    const adminSecret = await secretsmanager.send(adminCmd);
    const adminPassword = JSON.parse(adminSecret.SecretString!).password;
    const adminUser = JSON.parse(adminSecret.SecretString!).username;

    //Create Databases
    let client = new Client({
        user: adminUser,
        host: process.env.server!,
        database: process.env.database!,
        password: adminPassword,
        port: parseInt(process.env.port!),
    });
    client.connect();
    await client.query('CREATE DATABASE tenant1;');
    await client.query('CREATE DATABASE tenant2;');
    await client.query('CREATE DATABASE pooledtenants;');
    await client.end();

    //Create Silo Tenant 1 Schema
    client = new Client({
        user: adminUser,
        host: process.env.server!,
        database: 'tenant1',
        password: adminPassword,
        port: parseInt(process.env.port!),
    });
    const params1 = {
        SecretId: process.env.tenant1password,
    };
    const cmd1 = new GetSecretValueCommand(params1);
    const secret1 = await secretsmanager.send(cmd1);
    const tenant1Password = JSON.parse(secret1.SecretString!).password;
    await client.connect();
    await client.query('CREATE USER tenant1; GRANT rds_iam TO tenant1;');
    await client.query(`CREATE USER tenant1_login WITH PASSWORD '${tenant1Password}';`);
    await client.query('CREATE TABLE widget (id INT PRIMARY KEY, value DECIMAL(10, 2));');
    await client.query('GRANT SELECT, UPDATE, INSERT, DELETE ON ALL TABLES IN SCHEMA public to tenant1;');
    await client.query('GRANT SELECT, UPDATE, INSERT, DELETE ON ALL TABLES IN SCHEMA public to tenant1_login;');
    await client.query(`INSERT INTO widget (id, value) VALUES (1, 50.99);`);
    await client.query(`INSERT INTO widget (id, value) VALUES (2, 37.49);`);
    await client.end();

    //Create Silo Tenant 2 Schema
    client = new Client({
        user: adminUser,
        host: process.env.server!,
        database: 'tenant2',
        password: adminPassword,
        port: parseInt(process.env.port!),
    });
    const params2 = {
        SecretId: process.env.tenant2password,
    };
    const cmd2 = new GetSecretValueCommand(params2);
    const secret2 = await secretsmanager.send(cmd2);
    const tenant2Password = JSON.parse(secret2.SecretString!).password;
    await client.connect();
    await client.query('CREATE USER tenant2; GRANT rds_iam TO tenant2;');
    await client.query(`CREATE USER tenant2_login WITH PASSWORD '${tenant2Password}';`);
    await client.query('CREATE TABLE widget (id INT PRIMARY KEY, value DECIMAL(10, 2));');
    await client.query('GRANT SELECT, UPDATE, INSERT, DELETE ON ALL TABLES IN SCHEMA public to tenant2;');
    await client.query('GRANT SELECT, UPDATE, INSERT, DELETE ON ALL TABLES IN SCHEMA public to tenant2_login;');
    await client.query(`INSERT INTO widget (id, value) VALUES (1, 18.00);`);
    await client.query(`INSERT INTO widget (id, value) VALUES (2, 32.00);`);
    await client.end();

    //Create Pooled Tenants Schema
    client = new Client({
        user: adminUser,
        host: process.env.server!,
        database: 'pooledtenants',
        password: adminPassword,
        port: parseInt(process.env.port!),
    });
    const params3 = {
        SecretId: process.env.pooledPassword,
    };
    const cmd3 = new GetSecretValueCommand(params3);
    const secret3 = await secretsmanager.send(cmd3);
    const pooledPassword = JSON.parse(secret3.SecretString!).password;
    client.connect();
    await client.query('CREATE USER pooledtenants; GRANT rds_iam TO pooledtenants;');
    await client.query(`CREATE USER pooledtenants_login WITH PASSWORD '${pooledPassword}';`);
    await client.query('CREATE TABLE tenant (id INT PRIMARY KEY, name VARCHAR(50));');
    await client.query('CREATE TABLE widget (id INT PRIMARY KEY, value DECIMAL(10, 2), tenantId INT);');
    await client.query('GRANT SELECT, UPDATE, INSERT ON ALL TABLES IN SCHEMA public to pooledtenants;');
    await client.query('GRANT SELECT, UPDATE, INSERT ON ALL TABLES IN SCHEMA public to pooledtenants_login;');
    await client.query('ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;');
    await client.query('ALTER TABLE widget ENABLE ROW LEVEL SECURITY;');
    await client.query(
        `CREATE POLICY tenant_isolation_policy ON tenant USING (id = cast(current_setting('app.current_tenant') as int));`,
    );
    await client.query(
        `CREATE POLICY tenant_widget_isolation_policy ON widget USING (tenantId = cast(current_setting('app.current_tenant') as int));`,
    );
    await client.query(`INSERT INTO tenant (id, name) VALUES (1, 'tenant1');`);
    await client.query(`INSERT INTO tenant (id, name) VALUES (2, 'tenant2');`);
    await client.query(`INSERT INTO widget (id, value, tenantId) VALUES (1, 50.99, 1);`);
    await client.query(`INSERT INTO widget (id, value, tenantId) VALUES (2, 37.49, 1);`);
    await client.query(`INSERT INTO widget (id, value, tenantId) VALUES (3, 18.00, 2);`);
    await client.query(`INSERT INTO widget (id, value, tenantId) VALUES (4, 32.00, 2);`);
    await client.end();

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'data seeding complete',
        }),
    };
};
