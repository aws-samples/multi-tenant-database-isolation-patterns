import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export interface PoolComputePoolDbIamProps {
  dbResourceId: string;
  dbEndpoint: string;
  dbPort: string;
  region: string;
  accountId: string;
  vpc: ec2.Vpc;
  ca: string;
  caPath: string;
}

export class PoolComputePoolDbIam extends Construct {
  tenantFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: PoolComputePoolDbIamProps) {
    super(scope, id);
    // ABAC Tenant IAM Role
    const tenantRole = new iam.Role(this, "TenantRole", {
      assumedBy: new iam.ServicePrincipal(
        "lambda.amazonaws.com"
      ).withSessionTags(),
    });
    tenantRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          `arn:aws:rds-db:${props.region}:${props.accountId}:dbuser:${props.dbResourceId}/pooledtenants`,
        ],
        actions: ["rds-db:connect"],
      })
    );
    tenantRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
        ],
      })
    );
    tenantRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [tenantRole.roleArn],
        actions: ["sts:AssumeRole", "sts:TagSession"],
      })
    );

    // Shared Tenant Lambda Function
    this.tenantFunction = new NodejsFunction(this, "TenantFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "lambdaHandler",
      entry: path.join(__dirname, "./lambda/app.ts"),
      role: tenantRole,
      environment: {
        server: props.dbEndpoint,
        port: props.dbPort,
        ca: props.ca,
        ca_path: props.caPath,
        role_arn: tenantRole.roleArn,
        username: "pooledtenants",
        db: "pooledtenants",
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
