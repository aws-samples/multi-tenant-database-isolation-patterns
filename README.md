# Multi-tenant Database Isolation Patterns on AWS

This repository provides provisioning and connection code samples for various tenant-isolation strategies.

The examples in this repository are for PostgreSQL. Whilst the code provided uses an Amazon Relational Database (RDS) instance, they are also applicable to an Amazon Aurora with PostgreSQL compatibility database.

## Getting Started

The examples are provisioned using the Cloud Development Kit (CDK). To install the CDK locally, follow the instructions in the [CDK documentation](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install):

```
npm install -g aws-cdk
```

With CDK installed, you can deploy all the examples to your own AWS account from the root of the repository.

First install dependencies & bootstrap the CDK application:

```
npm install && cdk bootstrap
```

Then deploy the CDK application:

```
cdk deploy
```

Once the CDK application is deployed, run the `DataGenerationFunction` lambda function first to seed some sample data.

## The Examples

The examples are all implemented as AWS Lambda functions written in Typescript. The logic should be transferable to your language or framework of choice.

### 1 - Silo Compute, Database per tenant with IAM Authentication

In this pattern a compute resource is deployed per tenant. For this example the compute resource is a Lambda function per tenant. This Lambda function then assumes a specific IAM role for each tenant. This IAM role is then scoped to be able to authenticate against a specific RDS database. There is then a database per tenant. For simplicty, this is implemented as a database per tenant on the same RDS instance (Bridge model), but it could be implemented as an RDS instance per tenant (Silo model) to provide addditional network-level isolation.

![Image 1](/img/pattern1.png)

### 2 - Silo Compute, Database per tenant with Secrets Manager Authentication

As in pattern 1, there is a Lambda function and database per tenant. In this example, authentication is provided by AWS Secrets Manager. A Secret is stored per tenant and this is retrieved at runtime based on the environment variable passed in to the Lambda function. These secrets are then rotated automatically using the built-in rotation capability of Secrets Manager.

![Image 2](/img/pattern2.png)

### 3 - Pool Compute, Database per tenant with IAM Authentication

This example is the same as pattern 1, but there is a single compute resource (Lambda function) that is shared ("pooled") by all tenants. In order to only allow a tenant to connect to their respective database, attribute-based access control is used to pass session tags into the role used to authenticate the user against the RDS database. For brevity, the tenant is retrieved from the event payload passed to the Lambda function, in the real world this would be retrieved as part of the authentication context.

Example event payload:

```json
{
  "tenant": "tenant1"
}
```

![Image 3](/img/pattern3.png)

### 4 - Pool Compute, Database per tenant with Secrets Manager Authentication

As with example 3, this example uses a single pool compute resource. It also uses attribute-based access control to retrieve a Secrets Manager secret based on the session tags used to assume the role to authenticate the tenant against the correct database.

Example event payload:

```json
{
  "tenant": "tenant1"
}
```

### 5 - Pool Compute, Pool Database with IAM Authentication

In example 5 a pool model is used for both the compute and the database. In this scenario, data isolation is enforced at the database level rather than at the network or IAM level. In practice, this is achieved by using [PostgreSQL Row Level Security policies](https://www.postgresql.org/docs/9.5/ddl-rowsecurity.html). This policy evaluates a session variable set based on the tenant context. This variable is then used to filter all result sets to only show results for that tenant. As with example 3, the tenant is retrieved via the event payload passed to the Lambda function. For a real-world deployment the tenant should be retrieved via the authentication context. To show the RLS policy working, the SQL queries in the application intentionally do not have any "WHERE" clause filter predicates, as a best practice, in a production application you should also include these query filters rather than relying solely on the RLS policy in order to provide an extra layer of protection against a misconfiguration.

Example event payload:

```json
{
  "tenantId": "1"
}
```

![Image 5](/img/pattern5.png)

### 6 - Pool Compute, Pool Database with Secrets Manager Authentication

As with example 5, a pool model is used for both compute and database. The difference is in this scenario a shared database secret is used and retrieved from Secrets Manager rather than a shared IAM role that is used for all tenants. The same tenant session variable is used to implement the Row Level Security.

```json
{
  "tenantId": "2"
}
```
