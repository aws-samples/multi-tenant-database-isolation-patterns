import { Stack, StackProps, Duration, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as custom from "aws-cdk-lib/custom-resources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { BridgeDbIam } from "../patterns/1-silo-compute-db-per-tenant-iam-auth/bridge-db-iam";
import { BridgeDbSecretsManager } from "../patterns/2-silo-compute-db-per-tenant-secrets-manager/bridge-db-secrets-manager";
import { PoolComputeBridgeDbIam } from "../patterns/3-pool-compute-db-per-tenant-iam-auth/silo-compute-iam";
import { PoolComputeBridgeDbSecretsManager } from "../patterns/4-pool-compute-db-per-tenant-secrets-manager/silo-compute-secrets-manager";
import { PoolComputePoolDbIam } from "../patterns/5-pool-compute-pooled-db-iam-auth/pool-db-iam";
import { PoolComputePoolDbSecretsManager } from "../patterns/6-pool-compute-pooled-db-secrets-manager/pool-db-secrets-manager";

export interface AwsDataIsolationPatternsStackProps {
  engineVersion: rds.PostgresEngineVersion;
}

const rdsCaUrl: string =
  "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
const rdsCertPath: string = "/tmp/global-bundle.pem";
const pwordExcludeChars: string = "!@#$%^&*'`\"";

export class AwsDataIsolationPatternsStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps & AwsDataIsolationPatternsStackProps
  ) {
    super(scope, id, props);

    // networking
    const vpc = new ec2.Vpc(this, `Vpc`);
    vpc.addFlowLog("VpcFlowLogs");

    // rds instance
    const db = new rds.DatabaseInstance(this, `DBInstance`, {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: props.engineVersion,
      }),
      vpc,
      iamAuthentication: true,
      databaseName: "postgres",
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      storageEncrypted: true,
      multiAz: true,
      deletionProtection: true,
    });
    db.addRotationSingleUser({
      automaticallyAfter: Duration.days(7),
      excludeCharacters: pwordExcludeChars,
    });

    // per-tenant db secrets
    const tenant1Secret = new rds.DatabaseSecret(this, "Tenant1Secret", {
      username: "tenant1_login",
      masterSecret: db.secret,
      excludeCharacters: pwordExcludeChars,
    });
    const attachedTenant1 = tenant1Secret.attach(db);
    Tags.of(tenant1Secret).add("tenant", "tenant1");

    db.addRotationMultiUser("Tenant1", {
      automaticallyAfter: Duration.days(7),
      secret: attachedTenant1,
    });

    const tenant2Secret = new rds.DatabaseSecret(this, "Tenant2Secret", {
      username: "tenant2_login",
      masterSecret: db.secret,
      excludeCharacters: pwordExcludeChars,
    });
    const attachedTenant2 = tenant2Secret.attach(db);
    Tags.of(tenant2Secret).add("tenant", "tenant2");

    db.addRotationMultiUser("Tenant2", {
      automaticallyAfter: Duration.days(7),
      secret: attachedTenant2,
    });

    const pooledSecret = new rds.DatabaseSecret(this, "PooledSecret", {
      username: "pooledtenants_login",
      masterSecret: db.secret,
      excludeCharacters: pwordExcludeChars,
    });
    const attachedPooledSecret = pooledSecret.attach(db);

    db.addRotationMultiUser("PooledTenant", {
      automaticallyAfter: Duration.days(7),
      secret: attachedPooledSecret,
    });

    // https://github.com/aws/aws-cdk/issues/11851
    const dbResourceId = new custom.AwsCustomResource(
      this,
      "DBInstanceGetResourceId",
      {
        onCreate: {
          service: "RDS",
          action: "describeDBInstances",
          parameters: {
            DBInstanceIdentifier: db.instanceIdentifier,
          },
          physicalResourceId: custom.PhysicalResourceId.fromResponse(
            "DBInstances.0.DbiResourceId"
          ),
          outputPaths: ["DBInstances.0.DbiResourceId"],
        },
        policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
          resources: custom.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      }
    );
    const resourceId = dbResourceId.getResponseField(
      "DBInstances.0.DbiResourceId"
    );

    // data generation lambda
    const dataGeneration = new NodejsFunction(this, "DataGenerationFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "lambdaHandler",
      entry: "./data-generation/app.ts",
      environment: {
        server: db.dbInstanceEndpointAddress,
        port: db.dbInstanceEndpointPort,
        adminSecret: db.secret!.secretArn,
        db: "dev",
        tenant1password: tenant1Secret.secretArn,
        tenant2password: tenant2Secret.secretArn,
        pooledPassword: pooledSecret.secretArn,
      },
      // https://github.com/aws/aws-cdk/issues/6323
      bundling: {
        // pg-native is not available and won't be used. This is letting the
        // bundler (esbuild) know pg-native won't be included in the bundled JS
        // file.
        externalModules: ["pg-native"],
      },
      vpc,
    });
    db.connections.allowDefaultPortFrom(dataGeneration);
    db.secret!.grantRead(dataGeneration);

    dataGeneration.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        resources: [
          tenant1Secret.secretArn,
          tenant2Secret.secretArn,
          pooledSecret.secretArn,
        ],
        actions: ["secretsmanager:GetSecretValue"],
      })
    );
    // custom resource to run lambda data generation

    // patterns
    // silo compute, db per tenant, iam auth
    const pattern1 = new BridgeDbIam(this, "BridgeDbIAMPattern", {
      dbResourceId: resourceId,
      dbEndpoint: db.dbInstanceEndpointAddress,
      dbPort: db.dbInstanceEndpointPort,
      region: Stack.of(this).region,
      accountId: Stack.of(this).account,
      vpc,
      ca: rdsCaUrl,
      caPath: rdsCertPath,
    });
    db.connections.allowDefaultPortFrom(pattern1.tenant1Function);
    db.connections.allowDefaultPortFrom(pattern1.tenant2Function);

    // silo compute, db per tenant, secrets manager
    const pattern2 = new BridgeDbSecretsManager(this, "BridgeDbSecretPattern", {
      dbResourceId: resourceId,
      dbEndpoint: db.dbInstanceEndpointAddress,
      dbPort: db.dbInstanceEndpointPort,
      region: Stack.of(this).region,
      accountId: Stack.of(this).account,
      vpc,
      tenant1Secret: tenant1Secret,
      tenant2Secret: tenant2Secret,
    });
    db.connections.allowDefaultPortFrom(pattern2.tenant1Function);
    db.connections.allowDefaultPortFrom(pattern2.tenant2Function);

    // pool compute, db per tenant, iam auth
    const pattern3 = new PoolComputeBridgeDbIam(
      this,
      "PoolComputeBridgeDbIAMPattern",
      {
        dbResourceId: resourceId,
        dbEndpoint: db.dbInstanceEndpointAddress,
        dbPort: db.dbInstanceEndpointPort,
        region: Stack.of(this).region,
        accountId: Stack.of(this).account,
        vpc,
        ca: rdsCaUrl,
        caPath: rdsCertPath,
      }
    );
    db.connections.allowDefaultPortFrom(pattern3.tenantFunction);

    // pool compute, db per tenant, secrets manager
    const pattern4 = new PoolComputeBridgeDbSecretsManager(
      this,
      "PoolComputeBridgeDbSecretPattern",
      {
        dbResourceId: resourceId,
        dbEndpoint: db.dbInstanceEndpointAddress,
        dbPort: db.dbInstanceEndpointPort,
        region: Stack.of(this).region,
        accountId: Stack.of(this).account,
        vpc,
      }
    );
    db.connections.allowDefaultPortFrom(pattern4.tenantFunction);

    // pool compute, row level security, iam auth
    const pattern5 = new PoolComputePoolDbIam(
      this,
      "PoolComputePoolDBIAMPattern",
      {
        dbResourceId: resourceId,
        dbEndpoint: db.dbInstanceEndpointAddress,
        dbPort: db.dbInstanceEndpointPort,
        region: Stack.of(this).region,
        accountId: Stack.of(this).account,
        vpc,
        ca: rdsCaUrl,
        caPath: rdsCertPath,
      }
    );
    db.connections.allowDefaultPortFrom(pattern5.tenantFunction);

    // pool compute, row level security, secrets manager
    const pattern6 = new PoolComputePoolDbSecretsManager(
      this,
      "PoolComputePoolDBSecretsManagerPattern",
      {
        dbEndpoint: db.dbInstanceEndpointAddress,
        dbPort: db.dbInstanceEndpointPort,
        region: Stack.of(this).region,
        accountId: Stack.of(this).account,
        vpc,
        secret: pooledSecret,
      }
    );
    db.connections.allowDefaultPortFrom(pattern6.tenantFunction);
  }
}
