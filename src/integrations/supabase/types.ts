export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_feedback: {
        Row: {
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          org_id: string | null
          rating: string
          suggestion_label: string | null
          suggestion_text: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          org_id?: string | null
          rating: string
          suggestion_label?: string | null
          suggestion_text: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          org_id?: string | null
          rating?: string
          suggestion_label?: string | null
          suggestion_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_feedback_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_feedback_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendant_instances: {
        Row: {
          attendant_user_id: string
          created_at: string
          id: string
          instance_id: string
        }
        Insert: {
          attendant_user_id: string
          created_at?: string
          id?: string
          instance_id: string
        }
        Update: {
          attendant_user_id?: string
          created_at?: string
          id?: string
          instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendant_instances_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      attendant_supervisors: {
        Row: {
          attendant_user_id: string
          created_at: string
          id: string
          supervisor_user_id: string
        }
        Insert: {
          attendant_user_id: string
          created_at?: string
          id?: string
          supervisor_user_id: string
        }
        Update: {
          attendant_user_id?: string
          created_at?: string
          id?: string
          supervisor_user_id?: string
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          automation_id: string
          completed_at: string | null
          contact_id: string | null
          contact_phone: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          nodes_executed: Json
          org_id: string | null
          started_at: string
          status: string
          trigger_type: string
        }
        Insert: {
          automation_id: string
          completed_at?: string | null
          contact_id?: string | null
          contact_phone?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          nodes_executed?: Json
          org_id?: string | null
          started_at?: string
          status?: string
          trigger_type: string
        }
        Update: {
          automation_id?: string
          completed_at?: string | null
          contact_id?: string | null
          contact_phone?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          nodes_executed?: Json
          org_id?: string | null
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          flow: Json
          id: string
          instance_id: string | null
          is_active: boolean | null
          name: string
          org_id: string | null
          stats: Json | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          flow?: Json
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          name: string
          org_id?: string | null
          stats?: Json | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          flow?: Json
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          name?: string
          org_id?: string | null
          stats?: Json | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_contacts: {
        Row: {
          campaign_id: string
          contact_id: string | null
          delivered_at: string | null
          error: string | null
          id: string
          message_id: string | null
          org_id: string | null
          phone: string
          read_at: string | null
          sent_at: string | null
          status: string
          variables: Json | null
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          delivered_at?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          org_id?: string | null
          phone: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          variables?: Json | null
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          delivered_at?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          org_id?: string | null
          phone?: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          instance_id: string | null
          media_url: string | null
          message_content: string | null
          message_type: string
          name: string
          org_id: string | null
          scheduled_at: string | null
          settings: Json
          started_at: string | null
          stats: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          instance_id?: string | null
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name: string
          org_id?: string | null
          scheduled_at?: string | null
          settings?: Json
          started_at?: string | null
          stats?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          instance_id?: string | null
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name?: string
          org_id?: string | null
          scheduled_at?: string | null
          settings?: Json
          started_at?: string | null
          stats?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          org_id: string | null
          tag_id: string
        }
        Insert: {
          contact_id: string
          org_id?: string | null
          tag_id: string
        }
        Update: {
          contact_id?: string
          org_id?: string | null
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          about: string | null
          conversation_summary: string | null
          created_at: string
          custom_fields: Json | null
          email: string | null
          id: string
          is_blocked: boolean | null
          last_message_at: string | null
          name: string | null
          org_id: string | null
          phone: string
          profile_picture: string | null
          updated_at: string
          user_id: string | null
          whatsapp_exists: boolean | null
        }
        Insert: {
          about?: string | null
          conversation_summary?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          is_blocked?: boolean | null
          last_message_at?: string | null
          name?: string | null
          org_id?: string | null
          phone: string
          profile_picture?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp_exists?: boolean | null
        }
        Update: {
          about?: string | null
          conversation_summary?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          is_blocked?: boolean | null
          last_message_at?: string | null
          name?: string | null
          org_id?: string | null
          phone?: string
          profile_picture?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp_exists?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          contact_id: string
          created_at: string
          funnel_id: string | null
          funnel_stage_id: string | null
          id: string
          last_message_at: string | null
          notes: string | null
          org_id: string | null
          priority: string
          score: number
          sla_hours: number | null
          status: string
          unread_count: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          contact_id: string
          created_at?: string
          funnel_id?: string | null
          funnel_stage_id?: string | null
          id?: string
          last_message_at?: string | null
          notes?: string | null
          org_id?: string | null
          priority?: string
          score?: number
          sla_hours?: number | null
          status?: string
          unread_count?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string
          created_at?: string
          funnel_id?: string | null
          funnel_stage_id?: string | null
          id?: string
          last_message_at?: string | null
          notes?: string | null
          org_id?: string | null
          priority?: string
          score?: number
          sla_hours?: number | null
          status?: string
          unread_count?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_funnel_stage_id_fkey"
            columns: ["funnel_stage_id"]
            isOneToOne: false
            referencedRelation: "funnel_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stages: {
        Row: {
          actions: Json
          auto_move_on_reply: boolean
          auto_move_stage_id: string | null
          color: string
          created_at: string
          funnel_id: string
          id: string
          name: string
          notify_after_hours: number | null
          org_id: string | null
          position: number
          score_threshold: number | null
        }
        Insert: {
          actions?: Json
          auto_move_on_reply?: boolean
          auto_move_stage_id?: string | null
          color?: string
          created_at?: string
          funnel_id: string
          id?: string
          name: string
          notify_after_hours?: number | null
          org_id?: string | null
          position?: number
          score_threshold?: number | null
        }
        Update: {
          actions?: Json
          auto_move_on_reply?: boolean
          auto_move_stage_id?: string | null
          color?: string
          created_at?: string
          funnel_id?: string
          id?: string
          name?: string
          notify_after_hours?: number | null
          org_id?: string | null
          position?: number
          score_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stages_auto_move_stage_id_fkey"
            columns: ["auto_move_stage_id"]
            isOneToOne: false
            referencedRelation: "funnel_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_stages_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funnel_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      funnels: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          org_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          org_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funnels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          category_id: string
          content: string
          created_at: string
          created_by: string | null
          hit_count: number
          id: string
          is_active: boolean
          org_id: string | null
          tags: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          category_id: string
          content: string
          created_at?: string
          created_by?: string | null
          hit_count?: number
          id?: string
          is_active?: boolean
          org_id?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          hit_count?: number
          id?: string
          is_active?: boolean
          org_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "knowledge_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_articles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_categories: {
        Row: {
          always_inject: boolean
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          always_inject?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          always_inject?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          content: string | null
          created_at: string
          direction: string
          external_id: string | null
          id: string
          media_url: string | null
          metadata: Json | null
          org_id: string | null
          status: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          content?: string | null
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          media_url?: string | null
          metadata?: Json | null
          org_id?: string | null
          status?: string | null
          type?: string
          user_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          content?: string | null
          created_at?: string
          direction?: string
          external_id?: string | null
          id?: string
          media_url?: string | null
          metadata?: Json | null
          org_id?: string | null
          status?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_history: {
        Row: {
          action: string
          changes: Json
          created_at: string
          id: string
          occurrence_id: string
          org_id: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          changes?: Json
          created_at?: string
          id?: string
          occurrence_id: string
          org_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          changes?: Json
          created_at?: string
          id?: string
          occurrence_id?: string
          org_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_history_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrences: {
        Row: {
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          org_id: string | null
          priority: string
          resolution: string | null
          resolved_at: string | null
          status: string
          store_name: string
          type: string
          updated_at: string
        }
        Insert: {
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          org_id?: string | null
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          store_name: string
          type?: string
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          org_id?: string | null
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          store_name?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string | null
          price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
          price?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
          price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id?: string
          name: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scoring_rules: {
        Row: {
          condition: Json
          created_at: string
          description: string | null
          event_type: string
          funnel_id: string
          id: string
          is_active: boolean
          org_id: string | null
          points: number
        }
        Insert: {
          condition?: Json
          created_at?: string
          description?: string | null
          event_type?: string
          funnel_id: string
          id?: string
          is_active?: boolean
          org_id?: string | null
          points?: number
        }
        Update: {
          condition?: Json
          created_at?: string
          description?: string | null
          event_type?: string
          funnel_id?: string
          id?: string
          is_active?: boolean
          org_id?: string | null
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_rules_funnel_id_fkey"
            columns: ["funnel_id"]
            isOneToOne: false
            referencedRelation: "funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          id: string
          key: string
          org_id: string | null
          user_id: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          org_id?: string | null
          user_id: string
          value: Json
        }
        Update: {
          id?: string
          key?: string
          org_id?: string | null
          user_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          media_url: string | null
          name: string
          org_id: string | null
          type: string
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          name: string
          org_id?: string | null
          type?: string
          updated_at?: string
          variables?: string[] | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          media_url?: string | null
          name?: string
          org_id?: string | null
          type?: string
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          allowed_pages: string[]
          can_create_automations: boolean
          can_create_campaigns: boolean
          can_create_contacts: boolean
          can_delete_automations: boolean
          can_delete_campaigns: boolean
          can_delete_contacts: boolean
          can_edit_automations: boolean
          can_edit_contacts: boolean
          can_execute_campaigns: boolean
          can_manage_funnels: boolean
          can_manage_occurrences: boolean
          can_manage_templates: boolean
          can_view_reports: boolean
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_pages?: string[]
          can_create_automations?: boolean
          can_create_campaigns?: boolean
          can_create_contacts?: boolean
          can_delete_automations?: boolean
          can_delete_campaigns?: boolean
          can_delete_contacts?: boolean
          can_edit_automations?: boolean
          can_edit_contacts?: boolean
          can_execute_campaigns?: boolean
          can_manage_funnels?: boolean
          can_manage_occurrences?: boolean
          can_manage_templates?: boolean
          can_view_reports?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_pages?: string[]
          can_create_automations?: boolean
          can_create_campaigns?: boolean
          can_create_contacts?: boolean
          can_delete_automations?: boolean
          can_delete_campaigns?: boolean
          can_delete_contacts?: boolean
          can_edit_automations?: boolean
          can_edit_contacts?: boolean
          can_execute_campaigns?: boolean
          can_manage_funnels?: boolean
          can_manage_occurrences?: boolean
          can_manage_templates?: boolean
          can_view_reports?: boolean
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          admin_token: string | null
          base_url: string
          created_at: string
          device_name: string | null
          id: string
          instance_name: string | null
          instance_token: string | null
          is_default: boolean
          name: string
          org_id: string | null
          phone: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_token?: string | null
          base_url: string
          created_at?: string
          device_name?: string | null
          id?: string
          instance_name?: string | null
          instance_token?: string | null
          is_default?: boolean
          name: string
          org_id?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_token?: string | null
          base_url?: string
          created_at?: string
          device_name?: string | null
          id?: string
          instance_name?: string | null
          instance_token?: string | null
          is_default?: boolean
          name?: string
          org_id?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_admin_uazapi_config: { Args: never; Returns: Json }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_kb_hit_count: {
        Args: { _article_id: string }
        Returns: undefined
      }
      is_attendant_of: { Args: { _owner_user_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      same_org: { Args: { _user_id: string }; Returns: boolean }
      search_products: {
        Args: { _limit?: number; _query: string; _user_id: string }
        Returns: {
          barcode: string
          category: string
          id: string
          name: string
          price: number
          similarity: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "atendente"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "supervisor", "atendente"],
    },
  },
} as const
