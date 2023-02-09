import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export interface BridgeDbIamProps {
  dbResourceId: string;
  dbEndpoint: string;
  dbPort: string;
  region: string;
  accountId: string;
  vpc: ec2.Vpc;
  ca: string;
  caPath: string;
}

export class BridgeDbIam extends Construct {
  tenant1Function: NodejsFunction;
  tenant2Function: NodejsFunction;

  constructor(scope: Construct, id: string, props: BridgeDbIamProps) {
    super(scope, id);
    // Per Tenant IAM Role
    const tenant1Role = new iam.Role(this, "SiloIAMTenant1Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    tenant1Role.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          `arn:aws:rds-db:${props.region}:${props.accountId}:dbuser:${props.dbResourceId}/tenant1`,
        ],
        actions: ["rds-db:connect"],
      })
    );
    tenant1Role.addToPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
        ],
      })
    );

    const tenant2Role = new iam.Role(this, "SiloIAMTenant2Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    tenant2Role.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          "arn:aws:rds-db:" +
            props.region +
            ":" +
            props.accountId +
            ":dbuser:" +
            props.dbResourceId +
            "/tenant2",
        ],
        actions: ["rds-db:connect"],
      })
    );
    tenant2Role.addToPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
        ],
      })
    );

    // Per Tenant Lambda Function
    this.tenant1Function = new NodejsFunction(this, "SiloIAMTenant1Function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "lambdaHandler",
      entry: path.join(__dirname, "./lambda/app.ts"),
      role: tenant1Role,
      environment: {
        server: props.dbEndpoint,
        port: props.dbPort,
        user: "tenant1",
        db: "tenant1",
        ca: props.ca,
        ca_path: props.caPath,
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

    this.tenant2Function = new NodejsFunction(this, "SiloIAMTenant2Function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "lambdaHandler",
      entry: path.join(__dirname, "./lambda/app.ts"),
      role: tenant2Role,
      environment: {
        server: props.dbEndpoint,
        port: props.dbPort,
        user: "tenant2",
        db: "tenant2",
        ca: props.ca,
        ca_path: props.caPath,
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
