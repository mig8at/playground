package check

/* AWS por servicio: a qué servicios alcanza cada perfil de ~/.aws, y con qué permiso.
 *
 * POR QUÉ SE MIDE Y NO SE LEE. Lo natural sería leer la política del rol y deducir los permisos, pero el
 * permission set de SSO (`AWSReservedSSO_DeveloperAccess_…`) no deja leerse a sí mismo: `iam:GetRole`,
 * `iam:ListAttachedRolePolicies` e `iam:SimulatePrincipalPolicy` dan AccessDenied (medido el 2026-09-28), y
 * el permission set no está en el repo `infrastructure`. Entonces se pregunta a cada servicio con UNA
 * llamada de lectura (List/Describe, de a un elemento) y se anota lo que contesta.
 *
 * LA ESCRITURA NO SE MIDE TODAVÍA: la única forma de saberla sin la política es mandar una llamada de
 * escritura, y eso lo decide Miguel. Hasta entonces sale «sin medir», nunca «no».
 *
 * Cada fila dice qué acción se probó, así un «no» se puede verificar a mano. */

import (
	"context"
	"encoding/json"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Access es lo que se sabe de un permiso.
type Access string

const (
	Yes        Access = "yes"        // la llamada se autorizó
	No         Access = "no"         // AWS la negó por permisos
	Unknown    Access = "error"      // falló por otra cosa (red, región, parámetros): no dice nada del permiso
	Unmeasured Access = "unmeasured" // no se probó
)

// Service es una fila de la matriz.
type Service struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Category string `json:"category"`
	Action   string `json:"action"`  // la acción de IAM que se probó
	Command  string `json:"command"` // la llamada del CLI que la prueba, sin el perfil: se reproduce a mano
	Read     Access `json:"read"`
	Write    Access `json:"write"`
	Detail   string `json:"detail"`
	Millis   int64  `json:"ms"`
}

// Account es un perfil de ~/.aws con su identidad y sus servicios.
type Account struct {
	Profile      string `json:"profile"`
	Account      string `json:"account"`
	AccountLabel string `json:"accountLabel"`
	Role         string `json:"role"`
	// PermissionSet es el nombre del permission set de SSO (`DeveloperAccess`, `ReadOnlyAccess`). Es una
	// PISTA de la escritura, no una medición: el nombre lo pone quien administra AWS.
	PermissionSet string     `json:"permissionSet"`
	Person        string     `json:"person"`
	Credentials   string     `json:"credentials"`
	Expires       *time.Time `json:"expires,omitempty"`
	Error         string     `json:"error,omitempty"`
	Services      []Service  `json:"services"`

	// NoCredentials: el perfil no tiene credenciales propias (sólo configuración). No es un acceso: se oculta.
	NoCredentials bool `json:"noCredentials,omitempty"`
}

// accountLabels nombra las cuentas de CreditOp. Sale del README y de los ARNs de `infrastructure`: la de
// desarrollo es `accounts/development-697767917359`, y los recursos de `environments/prod` (ECS, ALB,
// ECR) viven en 299276669008, que el README llama «cuenta compartida (ECR)».
var accountLabels = map[string]string{
	"697767917359": "desarrollo",
	"299276669008": "compartida: producción y ECR",
}

// Categories es el orden en que se muestran los grupos de servicios.
var Categories = []string{"cómputo", "datos", "red", "mensajería", "seguridad", "observabilidad", "despliegue"}

// awsServices: el servicio, su acción de lectura más barata y los argumentos del CLI que la hacen. De a un
// elemento: se pregunta si se puede, no qué hay.
var awsServices = []struct {
	id, label, category, action string
	args                        []string
}{
	{"ecs", "ECS", "cómputo", "ecs:ListClusters", []string{"ecs", "list-clusters", "--max-items", "1"}},
	{"lambda", "Lambda", "cómputo", "lambda:ListFunctions", []string{"lambda", "list-functions", "--max-items", "1"}},
	{"ecr", "ECR", "cómputo", "ecr:DescribeRepositories", []string{"ecr", "describe-repositories", "--max-items", "1"}},
	{"s3", "S3", "datos", "s3:ListAllMyBuckets", []string{"s3api", "list-buckets", "--max-items", "1"}},
	{"dynamodb", "DynamoDB", "datos", "dynamodb:ListTables", []string{"dynamodb", "list-tables", "--max-items", "1"}},
	{"rds", "RDS", "datos", "rds:DescribeDBInstances", []string{"rds", "describe-db-instances", "--max-items", "1"}},
	{"secretsmanager", "Secrets Manager", "datos", "secretsmanager:ListSecrets", []string{"secretsmanager", "list-secrets", "--max-items", "1"}},
	{"ssm", "SSM Parameter Store", "datos", "ssm:DescribeParameters", []string{"ssm", "describe-parameters", "--max-items", "1"}},
	{"ec2", "EC2 y VPC", "red", "ec2:DescribeVpcs", []string{"ec2", "describe-vpcs", "--max-items", "1"}},
	{"elbv2", "Balanceadores (ALB)", "red", "elasticloadbalancing:DescribeLoadBalancers", []string{"elbv2", "describe-load-balancers", "--max-items", "1"}},
	{"apigatewayv2", "API Gateway", "red", "apigateway:GET", []string{"apigatewayv2", "get-apis", "--max-items", "1"}},
	{"route53", "Route 53", "red", "route53:ListHostedZones", []string{"route53", "list-hosted-zones", "--max-items", "1"}},
	{"servicediscovery", "Cloud Map", "red", "servicediscovery:ListNamespaces", []string{"servicediscovery", "list-namespaces", "--max-items", "1"}},
	{"cloudfront", "CloudFront", "red", "cloudfront:ListDistributions", []string{"cloudfront", "list-distributions", "--max-items", "1"}},
	{"sqs", "SQS", "mensajería", "sqs:ListQueues", []string{"sqs", "list-queues", "--max-items", "1"}},
	{"sns", "SNS", "mensajería", "sns:ListTopics", []string{"sns", "list-topics", "--max-items", "1"}},
	{"events", "EventBridge", "mensajería", "events:ListRules", []string{"events", "list-rules", "--limit", "1"}},
	{"iam", "IAM", "seguridad", "iam:ListRoles", []string{"iam", "list-roles", "--max-items", "1"}},
	{"kms", "KMS", "seguridad", "kms:ListKeys", []string{"kms", "list-keys", "--max-items", "1"}},
	{"acm", "Certificados (ACM)", "seguridad", "acm:ListCertificates", []string{"acm", "list-certificates", "--max-items", "1"}},
	{"cognito-idp", "Cognito", "seguridad", "cognito-idp:ListUserPools", []string{"cognito-idp", "list-user-pools", "--max-results", "1"}},
	{"logs", "CloudWatch Logs", "observabilidad", "logs:DescribeLogGroups", []string{"logs", "describe-log-groups", "--max-items", "1"}},
	{"cloudwatch", "CloudWatch (alarmas)", "observabilidad", "cloudwatch:DescribeAlarms", []string{"cloudwatch", "describe-alarms", "--max-items", "1"}},
	{"cloudformation", "CloudFormation", "despliegue", "cloudformation:ListStacks", []string{"cloudformation", "list-stacks", "--max-items", "1"}},
}

// AWSServiceList son los servicios que se miden, en el orden en que salen en cada cuenta.
func AWSServiceList() []Service {
	out := make([]Service, len(awsServices))
	for i, s := range awsServices {
		out[i] = Service{ID: s.id, Label: s.label, Category: s.category, Action: s.action, Command: "aws " + strings.Join(s.args, " ")}
	}
	return out
}

// rePermissionSet saca el nombre del permission set del rol que crea SSO: `AWSReservedSSO_<nombre>_<hash>`.
var rePermissionSet = regexp.MustCompile(`^AWSReservedSSO_(.+)_[0-9a-f]{16}$`)

// reDenied reconoce una negativa por permisos en cualquiera de los dialectos de AWS.
var reDenied = regexp.MustCompile(`AccessDenied|UnauthorizedOperation|AuthorizationError|not authorized to perform|AccessDeniedException`)

// reWhy extrae el motivo de la negativa: «no identity-based policy allows» (nadie lo dio) o «explicit
// deny» (alguien lo quitó a propósito), que son dos conversaciones distintas con quien administra AWS.
var reWhy = regexp.MustCompile(`because (no identity-based policy allows the [^ ]+ action|[^.]*explicit deny[^.]*)`)

// AWSProfiles son los perfiles de ~/.aws, sin medir: la interfaz los pide primero para dibujar las columnas
// y después mide cada uno por separado.
func AWSProfiles(ctx context.Context) ([]string, error) {
	if _, err := exec.LookPath("aws"); err != nil {
		return nil, err
	}
	raw, err := exec.CommandContext(ctx, "aws", "configure", "list-profiles").Output()
	if err != nil {
		return nil, err
	}
	return strings.Fields(string(raw)), nil
}

// AWSAccount mide UN perfil: su identidad y la lectura de cada servicio.
func AWSAccount(ctx context.Context, profile string) Account { return awsAccount(ctx, profile) }

// AWSAccounts mide cada perfil de ~/.aws, en paralelo. Los perfiles sin credenciales propias no son un
// acceso: salen aparte, en `hidden`, para que quien mira sepa que se ocultaron y no que no existen.
func AWSAccounts(ctx context.Context) (accounts []Account, hidden []string, err error) {
	if _, err := exec.LookPath("aws"); err != nil {
		return nil, nil, err
	}
	raw, err := exec.CommandContext(ctx, "aws", "configure", "list-profiles").Output()
	if err != nil {
		return nil, nil, err
	}
	profiles := strings.Fields(string(raw))
	out := make([]Account, len(profiles))
	var wg sync.WaitGroup
	for i, p := range profiles {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			out[i] = awsAccount(ctx, p)
		}(i, p)
	}
	wg.Wait()
	for _, a := range out {
		if a.NoCredentials {
			hidden = append(hidden, a.Profile)
			continue
		}
		accounts = append(accounts, a)
	}
	return accounts, hidden, nil
}

func awsAccount(ctx context.Context, profile string) Account {
	a := Account{Profile: profile}
	cmd := exec.CommandContext(ctx, "aws", "sts", "get-caller-identity", "--profile", profile, "--output", "json")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil {
		a.Error = awsReason(stderr.String(), err)
		a.NoCredentials = noCredentials(stderr.String())
		return a
	}
	var id struct{ Account, Arn string }
	_ = json.Unmarshal(raw, &id)
	a.Account, a.AccountLabel = id.Account, accountLabels[id.Account]
	if a.AccountLabel == "" {
		a.AccountLabel = "cuenta sin nombre en infrastructure"
	}
	role := shortArn(id.Arn)
	if i := strings.LastIndex(role, "/"); i >= 0 {
		a.Role, a.Person = role[:i], role[i+1:]
	} else {
		a.Role = role
	}
	if m := rePermissionSet.FindStringSubmatch(a.Role); m != nil {
		a.PermissionSet = m[1]
	}
	if exp, ok := awsExpiration(ctx, profile); ok {
		a.Expires = &exp
		a.Credentials = "temporales"
	} else if at, ok := pastedAt(profile); ok {
		a.Credentials = "pegadas a mano el " + at.Format("02/01 15:04") + ", sin vencimiento declarado"
	} else {
		a.Credentials = "fijas (sin vencimiento)"
	}

	a.Services = make([]Service, len(awsServices))
	var wg sync.WaitGroup
	for i, s := range awsServices {
		wg.Add(1)
		go func(i int, id, label, category, action string, args []string) {
			defer wg.Done()
			a.Services[i] = probeRead(ctx, profile, Service{ID: id, Label: label, Category: category, Action: action,
				Command: "aws " + strings.Join(args, " "), Write: Unmeasured}, args)
		}(i, s.id, s.label, s.category, s.action, s.args)
	}
	wg.Wait()
	return a
}

// probeRead corre la lectura de un servicio y clasifica la respuesta. Sólo AccessDenied y sus parientes
// cuentan como «no»: un timeout o un parámetro inválido no dicen nada del permiso.
func probeRead(ctx context.Context, profile string, s Service, args []string) Service {
	start := time.Now()
	full := append(append([]string{}, args...), "--profile", profile, "--output", "json")
	cmd := exec.CommandContext(ctx, "aws", full...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	err := cmd.Run()
	s.Millis = time.Since(start).Milliseconds()
	msg := strings.TrimSpace(stderr.String())
	switch {
	case err == nil:
		s.Read, s.Detail = Yes, "autorizado"
	case reDenied.MatchString(msg):
		s.Read, s.Detail = No, "negado"
		if m := reWhy.FindStringSubmatch(msg); m != nil {
			if strings.Contains(m[1], "explicit deny") {
				s.Detail = "negado explícitamente (un deny, no una falta)"
			} else {
				s.Detail = "ninguna política lo da"
			}
		}
	default:
		s.Read, s.Detail = Unknown, firstLine(msg)
		if s.Detail == "" {
			s.Detail = firstLine(err.Error())
		}
	}
	return s
}
