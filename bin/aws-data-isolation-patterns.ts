#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AwsDataIsolationPatternsStack } from "../lib/aws-data-isolation-patterns-stack";
import * as rds from "aws-cdk-lib/aws-rds";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";

const app = new cdk.App();
const stack = new AwsDataIsolationPatternsStack(
  app,
  "AwsDataIsolationPatterns",
  {
    engineVersion: rds.PostgresEngineVersion.VER_13_4,
  }
);
cdk.Aspects.of(app).add(new AwsSolutionsChecks());
NagSuppressions.addStackSuppressions(stack, [
  {
    id: "AwsSolutions-L1",
    reason: "Custom resource is currently hardcoded to NodeJS 14",
  },
  {
    id: "AwsSolutions-IAM5",
    reason:
      "IAM policy resources not scoped where the resource ID is not known ahead of time for create operations",
  },
  {
    id: "AwsSolutions-IAM4",
    reason:
      "AWS Managed Policies used in this solution are:  AWSLambdaBasicExecutionRole",
  },
  {
    id: "AwsSolutions-RDS11",
    reason: "Using default endpoint port for convention",
  },
]);
