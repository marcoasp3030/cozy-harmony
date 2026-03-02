
# Corrigir acesso ao menu Atendentes

## Problema identificado

As politicas de seguranca (RLS) da tabela `user_roles` estao configuradas como **RESTRICTIVE** (restritivas). No PostgreSQL, quando todas as politicas sao restritivas e nao existe nenhuma politica permissiva, o acesso e negado por padrao. Isso faz com que a consulta ao papel do usuario retorne vazio, e o sistema entende que voce nao tem permissao.

## Solucao

Recriar as politicas RLS da tabela `user_roles` como **PERMISSIVE** (o padrao do PostgreSQL), onde basta uma delas ser satisfeita para permitir o acesso.

## Passos

### 1. Migrar politicas RLS da tabela `user_roles`

Remover as 3 politicas atuais (restritivas) e recriar como permissivas:

- **Admins can manage all roles** (ALL) -- admins tem acesso total
- **Users can view own roles** (SELECT) -- cada usuario pode ver seu proprio papel
- **Supervisors can view all roles** (SELECT) -- supervisores podem ver todos os papeis

### 2. Corrigir warning de ref no Dialog

O console mostra um warning sobre `Function components cannot be given refs` no `UserManagement`. Isso sera corrigido ajustando a estrutura dos Dialogs para nao usar componentes funcionais diretamente como children do Dialog.

## Detalhes tecnicos

```sql
-- Drop restrictive policies
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Supervisors can view all roles" ON public.user_roles;

-- Recreate as PERMISSIVE (default)
CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Supervisors can view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'supervisor'::app_role));
```

Apos essa correcao, o hook `useUserRole` conseguira ler o papel do usuario corretamente, e o menu "Atendentes" aparecera no sidebar para admins e supervisores.
