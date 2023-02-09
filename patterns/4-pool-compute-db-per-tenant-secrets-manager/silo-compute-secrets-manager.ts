import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export interface PoolComputeBridgeDbSecretsManagerProps {
  dbResourceId: string;
  dbEndpoint: string;
  dbPort: string;
  region: string;
  accountId: string;
  vpc: ec2.Vpc;
}

export class PoolComputeBridgeDbSecretsManager extends Construct {
  tenantFunction: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: PoolComputeBridgeDbSecretsManagerProps
  ) {
    super(scope, id);

    // IAM role limited based on request/resource tag matching
    const lambdaRole = new iam.Role(this, "SiloSecretLambdaRole", {
      assumedBy: new iam.ServicePrincipal(
        "lambda.amazonaws.com"
      ).withSessionTags(),
    });
    const tenantRole = new iam.Role(this, "SiloSecretTenant1Role", {
      assumedBy: new iam.ArnPrincipal(lambdaRole.roleArn).withSessionTags(),
    });
    tenantRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [`*`],
        actions: ["secretsmanager:ListSecrets"],
      })
    );
    tenantRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          `arn:aws:secretsmanager:${props.region}:${props.accountId}:secret:Tenant*`,
        ],
        actions: ["secretsmanager:GetSecretValue"],
        conditions: {
          StringEquals: {
            "aws:PrincipalTag/tenant": "${aws:ResourceTag/tenant}",
          },
        },
      })
    );
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
        ],
      })
    );
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [tenantRole.roleArn],
        actions: ["sts:AssumeRole", "sts:TagSession"],
      })
    );

    // Shared Lambda Function
    this.tenantFunction = new NodejsFunction(this, "SecretTenantFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "lambdaHandler",
      entry: path.join(__dirname, "./lambda/app.ts"),
      role: lambdaRole,
      environment: {
        server: props.dbEndpoint,
        port: props.dbPort,
        role_arn: tenantRole.roleArn,
      },
      // https://github.com/aws/aws-cdk/issues/6323
      bundling: {
        // pg-native is not available and won't be used. This is letting the
        // bundler (esbuild) know pg-native won't be included in the bundled JS
        // file.
        externalModules: ["pg-native"],
      },
      vpc: props.vpc,
    });
  }
}
